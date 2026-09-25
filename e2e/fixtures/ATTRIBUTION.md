# Test fixtures

- `ifc/Building-*.ifc` and `ifc/Infra-*.ifc` come from buildingSMART's
  [Sample-Test-Files](https://github.com/buildingSMART/Sample-Test-Files) ("Simple-Scene" models),
  © buildingSMART International Ltd., licensed under
  [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- Modified copies of those files, made for these tests:
  - `ifc/Building-Architecture-ifc4-v2.ifc` is a second model version for the comparison suite. It has one renamed wall, one changed quantity, one moved element, one removed element and one added element.
  - `ifc/arch-ifc4-props.ifc` adds complex, enumerated, bounded and list properties, plus a door in a wall opening.
  - `ifc/mep-ifc2x3-legacy.ifc` and `ifc/mep-ifc4x3-new.ifc` add MEP classes (IFC2x3 legacy and IFC4.3), which That Open's default import list drops.
- `extra/box.ifc` and `extra/mep-pipes.ifc` are small synthetic models written for these tests. They are a 1 m cube, and pipes that cross it, used for measurements and clashes.
- `all_products.txt` lists every `IfcProduct` subtype across IFC2x3, IFC4 and IFC4.3. The class-coverage suite checks against it as an independent oracle.
- `notes.txt` is a non-model file, used to check the "unsupported file" message.

The ThatOpen `school_str.ifc` sample (MIT) is 8 MB, so it is not committed. `e2e/lib.mjs` downloads it once into `e2e/.cache/`.
