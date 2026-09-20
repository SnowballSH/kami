"""GX10-only model compatibility check; does not serve or modify the model."""

import sys
from pathlib import Path

from artifacts import validate_bundle
from recognizer import SketchRecognizer


def main() -> None:
    directory = Path(sys.argv[1]).resolve(strict=True)
    identity = validate_bundle(directory)
    SketchRecognizer(directory)
    print(identity)


if __name__ == "__main__":
    main()
