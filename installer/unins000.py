import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import installer as inst

sys.argv = [sys.argv[0], "--mode", "uninstall"] + sys.argv[1:]
inst.main()
