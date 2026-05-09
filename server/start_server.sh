#!/bin/bash
# Start MitoSpace Explorer backend server (uses conda env: deeplearning)

set -euo pipefail

echo "🚀 Starting MitoSpace Explorer backend..."
echo ""

# Check if we're in the server directory
if [ ! -f "main.py" ]; then
    echo "❌ Error: main.py not found. Please run this from the server/ directory"
    exit 1
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found. Chat system will be disabled."
    echo "   Copy .env.example to .env and add your OPENROUTER_API_KEY"
    echo ""
fi

# Activate conda environment deeplearning
if command -v conda >/dev/null 2>&1; then
    eval "$(conda shell.bash hook)"
elif [ -f "${HOME}/miniconda3/etc/profile.d/conda.sh" ]; then
    # shellcheck source=/dev/null
    source "${HOME}/miniconda3/etc/profile.d/conda.sh"
elif [ -f "${HOME}/anaconda3/etc/profile.d/conda.sh" ]; then
    # shellcheck source=/dev/null
    source "${HOME}/anaconda3/etc/profile.d/conda.sh"
else
    echo "❌ Error: conda not found. Install Miniconda/Anaconda or add conda to PATH."
    exit 1
fi

echo "🔧 Activating conda env: deeplearning..."
conda activate deeplearning

# Install/upgrade dependencies into the active env
echo "📥 Installing dependencies..."
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo ""
echo "✅ Dependencies installed"
echo ""
echo "🌐 Starting server on http://127.0.0.1:8000"
echo "   Press Ctrl+C to stop"
echo ""

python -m uvicorn main:app --reload --port 8000
