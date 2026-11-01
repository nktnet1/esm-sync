# Upstream issue 829

The two Utility.js files are unchanged from dyo/dyo commit
007ba068eb81ebbb7d2e48731d4a6ce230023dc1 (16 July 2019).
Source: https://github.com/dyo/dyo/tree/007ba068eb81ebbb7d2e48731d4a6ce230023dc1

Author: Sultan Tarimo. The pinned package declares the MIT license in its
package.json; that historical tree does not contain a separate license file.

The regression runs both original utility tests with Mocha 8.4.0 and Node's
assertion API. It exercises the original dynamic-import mechanism, including
temporary replacement of Symbol, Promise and timer globals, through the CLI
and synchronous Mocha loading paths. It does not run Dyo's complete DOM suite.

The `.gitattributes` LF rule preserves the original bytes on Windows. A real
Git checkout regression also enables `core.autocrlf=true` and verifies both hashes.

SHA-256:

- src/Utility.js: e6d8ae74678d6c2de9800d4eda059ebca126f4bae17113eb9762c2f19dca32d1
- test/Utility.js: d99fff6a6ef56367724f7fa7dea13ced41dbfb276eea9e9c61aa8a8b3e7e36e6
