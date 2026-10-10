# EZ-Tree (vendored)

Procedural tree generator by Daniel Greenheck — https://github.com/dgreenheck/ez-tree
Copied from `src/lib` at commit dcf309bd86bd521083d9c70f01f2de45fdc7c457, MIT licensed (see LICENSE).

Vendored rather than installed from npm because the npm build (~24 MB, bundled bark/leaf textures)
requires three >= 0.167, while only the geometry generator is needed here. Verdant Zero uses
`Tree#createGeometry()` and supplies its own texture-free procedural materials
(see `src/world/ReclaimTrees.js`). The source files are unmodified.
