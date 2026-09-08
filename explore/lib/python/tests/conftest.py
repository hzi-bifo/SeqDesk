"""Make the helper importable when pytest is started from any directory."""
import sys
from pathlib import Path

LIB_DIR = str(Path(__file__).resolve().parents[1])
if LIB_DIR not in sys.path:
    sys.path.insert(0, LIB_DIR)
