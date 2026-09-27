# Loaded by Python at start-up when this folder is on PYTHONPATH: applies the Continual figure theme.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    import continualfig
    continualfig.install()
except Exception as error:  # A theme problem must never stop an analysis.
    print(f"continualfig: not applied ({error})", file=sys.stderr)
