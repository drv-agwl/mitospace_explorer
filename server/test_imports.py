"""Quick test to verify all imports work"""
import sys

print("Testing imports...")
print()

try:
    print("✓ fastapi")
    from fastapi import FastAPI
except ImportError as e:
    print(f"✗ fastapi: {e}")
    sys.exit(1)

try:
    print("✓ pandas")
    import pandas as pd
except ImportError as e:
    print(f"✗ pandas: {e}")
    sys.exit(1)

try:
    print("✓ numpy")
    import numpy as np
except ImportError as e:
    print(f"✗ numpy: {e}")
    sys.exit(1)

try:
    print("✓ sklearn")
    from sklearn.neural_network import MLPRegressor
except ImportError as e:
    print(f"✗ sklearn: {e}")
    sys.exit(1)

try:
    print("✓ openai")
    import openai
except ImportError as e:
    print(f"✗ openai: {e}")
    sys.exit(1)

try:
    print("✓ dotenv")
    from dotenv import load_dotenv
except ImportError as e:
    print(f"✗ dotenv: {e}")
    sys.exit(1)

print()
print("All imports successful! ✅")
print()

# Test loading .env
import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("OPENROUTER_API_KEY")
if api_key:
    print(f"✓ OPENROUTER_API_KEY found (starts with: {api_key[:15]}...)")
else:
    print("⚠️  OPENROUTER_API_KEY not found in .env")

model = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3-70b-instruct")
print(f"✓ OPENROUTER_MODEL: {model}")

print()
print("Ready to start server! Run:")
print("  python -m uvicorn main:app --reload --port 8000")
