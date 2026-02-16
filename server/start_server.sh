#!/bin/bash
# Start MitoSpace Explorer backend server

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

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
    echo "✅ Virtual environment created"
    echo ""
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Install/upgrade dependencies
echo "📥 Installing dependencies..."
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo ""
echo "✅ Dependencies installed"
echo ""
echo "🌐 Starting server on http://127.0.0.1:8000"
echo "   Press Ctrl+C to stop"
echo ""

# Start server
python -m uvicorn main:app --reload --port 8000
