#!/usr/bin/env python3
"""
STRK20 mainnet pool census.

Reads only public chain data. No keys, no wallet, no viewing key.
Reproducible by anyone: `python3 scripts/pool-scan.py`

Design notes, each one the result of getting it wrong first:

  * The deployment block is found by BINARY SEARCH over
    `starknet_getClassHashAt`. Activity is lumpy (one 200k window holds 34
    events, its neighbour 412), so "scan back until an empty window" truncates.

  * All time arithmetic uses BLOCK TIMESTAMPS, never a constant block time.
    Starknet block time moved from ~2.60s to ~1.68s across this pool's history,
    so a fixed block offset spans different real durations at different points.
    A "+/-52,048 block" window meant 24h recently and 37.6h in April.

  * Windows are non-overlapping, so NO deduplication is applied. Deduping on the
    event shape would collapse two legitimate identical deposits made in one
    multicall.

  * Cohorts are reported both centred and TRAILING. Only the trailing number is
    honest for preflight: at signing time the future does not exist yet.

Terminology, kept strict (see docs/THREAT_MODEL.md):

  fingerprint       a rare (token, amount) pair. A property of ONE event.
  linkage signal    a fingerprint PLUS a corroborating public observable.
  traffic cohort    same-token events in a time window. Ambient activity.
  candidate cohort  same token AND same exact amount. What an observer doing
                    amount reconciliation actually chooses between.

This measures frequencies. It does not measure whether anything was actually
deanonymised, and there is no ground truth for that.
"""
import bisect
import json
import os
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

RPC = "https://rpc.starknet.lava.build"
POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a"
HDRS = {"content-type": "application/json", "user-agent": "Mozilla/5.0"}
CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", ".cache")

SEL_DEPOSIT = "0x9149d2123147c5f43d"
SEL_WITHDRAW = "0x2eed7e29b3502a726f"
SEL_VIEWING_KEY = "0x1321a492485b4f1985"

TOKENS = {
    "0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb": ("USDC", 6),
    "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": ("STRK", 18),
    "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": ("ETH", 18),
    "0x787150e306e6eae6e3f79dea881770e8bbff2c1b8eb490f969669ee945b3135": ("strkBTC", 8),
}

WINDOW = 200_000     # RPC rejects materially wider ranges
TS_STRIDE = 5_000    # block-timestamp sampling interval
DAY = 86_400


def rpc(method, params, timeout=90):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    req = urllib.request.Request(RPC, data=body.encode(), headers=HDRS)
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def sym(t):
    return TOKENS.get(t, (t[:10] + "…", 0))[0]


def dec(t):
    return TOKENS.get(t, (None, 0))[1]


def cached(name, build):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, name)
    if os.path.exists(path):
        with open(path) as fh:
            return json.load(fh)
    val = build()
    with open(path, "w") as fh:
        json.dump(val, fh)
    return val


def find_deployment_block(head):
    def deployed(b):
        return "result" in rpc("starknet_getClassHashAt", [{"block_number": b}, POOL], 40)

    if not deployed(head):
        raise SystemExit("pool not deployed at head")
    lo, hi = 0, head
    while lo < hi:
        mid = (lo + hi) // 2
        if deployed(mid):
            hi = mid
        else:
            lo = mid + 1
    return lo


def fetch_events(start, head):
    """Non-overlapping windows. No dedup: see module docstring."""
    events = []
    lo = start
    while lo <= head:
        hi = min(lo + WINDOW - 1, head)
        token, found = None, 0
        while True:
            f = {"from_block": {"block_number": lo}, "to_block": {"block_number": hi},
                 "address": POOL, "chunk_size": 1000}
            res = rpc("starknet_getEvents", [f if token is None else dict(f, continuation_token=token)])
            if "error" in res:
                print(f"  rpc error {lo}..{hi}: {res['error'].get('message')}")
                break
            r = res["result"]
            events.extend(r["events"])
            found += len(r["events"])
            token = r.get("continuation_token")
            if not token:
                break
        print(f"  {lo}..{hi}: {found}")
        lo = hi + 1
    return events


def build_timestamp_index(start, head):
    """Sample timestamps on a stride; interpolate between samples.

    Piecewise-linear over 5k-block segments. Block time drifts slowly and
    changes only at upgrades, so in-segment error is small relative to a 24h
    window, and far smaller than assuming one constant rate for 4.3M blocks.
    """
    marks = list(range(start, head, TS_STRIDE)) + [head]
    print(f"sampling {len(marks)} block timestamps…")

    def one(b):
        return b, rpc("starknet_getBlockWithTxHashes", [{"block_number": b}], 40)["result"]["timestamp"]

    with ThreadPoolExecutor(max_workers=16) as ex:
        pairs = sorted(ex.map(one, marks))
    return [p[0] for p in pairs], [p[1] for p in pairs]


def make_interp(bs, ts):
    def at(block):
        i = bisect.bisect_right(bs, block) - 1
        i = max(0, min(i, len(bs) - 2))
        b0, b1, t0, t1 = bs[i], bs[i + 1], ts[i], ts[i + 1]
        if b1 == b0:
            return t0
        return t0 + (t1 - t0) * (block - b0) / (b1 - b0)
    return at


def stats(xs, label, note=""):
    xs = sorted(xs)
    q = lambda p: xs[min(int(len(xs) * p), len(xs) - 1)]
    tiny = sum(1 for x in xs if x <= 5)
    alone = sum(1 for x in xs if x <= 1)
    print(f"\n{label}")
    if note:
        print(f"  {note}")
    print(f"  min {xs[0]}   p25 {q(.25)}   median {q(.5)}   p75 {q(.75)}   max {xs[-1]}")
    print(f"  5 or fewer : {tiny}/{len(xs)} = {100 * tiny / len(xs):.0f}%")
    print(f"  alone      : {alone}/{len(xs)} = {100 * alone / len(xs):.0f}%")


def main():
    head = rpc("starknet_blockNumber", [])["result"]
    start = cached("deploy.json", lambda: find_deployment_block(head))
    print(f"pool deployed at block {start}; head {head}")

    events = cached("events.json", lambda: fetch_events(start, head))
    bs, ts = cached("ts.json", lambda: build_timestamp_index(start, head))
    at = make_interp(bs, ts)

    t0, t1 = at(start), at(head)
    days = (t1 - t0) / DAY
    print(f"\nspan {days:.1f} days   average block time {(t1 - t0) / (head - start):.2f}s")

    deposits = [
        {"user": e["keys"][1], "token": e["keys"][2], "amount": int(e["data"][0], 16),
         "block": e["block_number"], "tx": e["transaction_hash"], "t": at(e["block_number"])}
        for e in events if e["keys"][0].startswith(SEL_DEPOSIT)
    ]
    withdrawals = [e for e in events if e["keys"][0].startswith(SEL_WITHDRAW)]
    regs = {e["keys"][1] for e in events if e["keys"][0].startswith(SEL_VIEWING_KEY)}

    print(f"\n{'=' * 64}\nSTRK20 POOL CENSUS - FULL HISTORY (timestamp-based)\n{'=' * 64}")
    print(f"pool events                             : {len(events)}")
    print(f"addresses that registered a viewing key : {len(regs)}")
    print(f"deposits                                : {len(deposits)}  ({len(deposits)/days:.0f}/day)")
    print(f"distinct depositor addresses            : {len({d['user'] for d in deposits})}")
    print(f"withdrawals                             : {len(withdrawals)}  ({len(withdrawals)/days:.0f}/day)")

    print("\ndeposits by token (top 5):")
    for t, n in Counter(d["token"] for d in deposits).most_common(5):
        print(f"  {sym(t):<9} {n}")

    amounts = Counter((d["token"], d["amount"]) for d in deposits)
    once = sum(1 for c in amounts.values() if c == 1)
    print(f"\ndistinct (token, amount) pairs          : {len(amounts)}")
    print(f"deposits whose amount is unique in range: {once}/{len(deposits)} = {100*once/len(deposits):.0f}%")
    print("  ^ unique-amount FINGERPRINT frequency, not demonstrated linkage")

    # ---- cohorts, in TIME ----
    by_token = defaultdict(list)
    by_amount = defaultdict(list)
    for d in deposits:
        by_token[d["token"]].append(d["t"])
        by_amount[(d["token"], d["amount"])].append(d["t"])
    for v in by_token.values():
        v.sort()
    for v in by_amount.values():
        v.sort()

    def count(sorted_ts, lo, hi):
        return bisect.bisect_right(sorted_ts, hi) - bisect.bisect_left(sorted_ts, lo)

    traffic_c, cand_c, cand_trail = [], [], []
    for d in deposits:
        tt, key = d["t"], (d["token"], d["amount"])
        traffic_c.append(count(by_token[d["token"]], tt - DAY, tt + DAY))
        cand_c.append(count(by_amount[key], tt - DAY, tt + DAY))
        cand_trail.append(count(by_amount[key], tt - DAY, tt))  # excludes the future

    stats(traffic_c, "TRAFFIC COHORT - same token, +/-24h (ambient context only):")
    stats(cand_c, "CANDIDATE COHORT - same token AND exact amount, +/-24h:",
          "retrospective; uses events that did not exist at signing time")
    stats(cand_trail, "CANDIDATE COHORT - TRAILING 24h (the preflight number):",
          "only what an observer could see when the user signs. This is the honest one.")

    # ---- concentration: is a popular amount real cover, or one bot? ----
    print(f"\n{'=' * 64}\nCOHORT QUALITY for the most-used amounts\n{'=' * 64}")
    print(f"{'amount':>22} {'tok':<8} {'uses':>5} {'addrs':>6} {'txs':>5} {'days':>5} {'top%':>5} {'burst%':>6}")
    for (tok, amt), n in amounts.most_common(10):
        rows = [d for d in deposits if d["token"] == tok and d["amount"] == amt]
        addrs = Counter(r["user"] for r in rows)
        udays = len({int(r["t"] // DAY) for r in rows})
        top = 100 * addrs.most_common(1)[0][1] / n
        times = sorted(r["t"] for r in rows)
        burst = max(
            bisect.bisect_right(times, t + DAY) - bisect.bisect_left(times, t)
            for t in times
        )
        print(f"{amt/10**dec(tok):>22,.6f} {sym(tok):<8} {n:>5} {len(addrs):>6} "
              f"{len({r['tx'] for r in rows}):>5} {udays:>5} {top:>4.0f}% {100*burst/n:>5.0f}%")
    print("\n  addrs = distinct depositors · days = distinct UTC days · top% = share from the")
    print("  single busiest address · burst% = largest share falling inside any one 24h window.")
    print("  High top% or high burst% means the 'cover' is one actor, not a crowd.")


if __name__ == "__main__":
    main()
