# Guard consumer example

This minimal TypeScript consumer imports only the published `@cutout/guard`
surface, constructs one typed STRK20 deposit action, and prints public version
metadata. It does not connect a wallet or submit a transaction.

The release verification installs the packed tarball into an isolated temporary
directory, typechecks this file, and runs the compiled output:

```bash
npm run package:consumer
```
