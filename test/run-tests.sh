#!/bin/bash
#
# Hyperchat Test Runner
# This script runs all tests and is suitable for CI/CD pipelines
#

set -e  # Exit on error

echo "================================"
echo "  Hyperchat Test Suite"
echo "================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node.js version
echo "📋 Checking prerequisites..."
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
echo "   Node.js: $NODE_VERSION"
echo "   npm: $NPM_VERSION"
echo ""

# Check for required Node.js version
REQUIRED_VERSION="18"
CURRENT_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)

if [ "$CURRENT_VERSION" -lt "$REQUIRED_VERSION" ]; then
    echo -e "${RED}❌ Error: Node.js $REQUIRED_VERSION or higher is required${NC}"
    echo "   Current version: $NODE_VERSION"
    exit 1
fi

echo -e "${GREEN}✓ Prerequisites met${NC}"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Clean up old test data
echo "🧹 Cleaning up old test data..."
npm run pretest
echo ""

# Run unit tests
echo "🧪 Running unit tests..."
if npm test; then
    echo -e "${GREEN}✓ Unit tests passed${NC}"
else
    echo -e "${RED}❌ Unit tests failed${NC}"
    exit 1
fi
echo ""

# Run integration tests
echo "🔗 Running integration tests..."
if npm run test:integration; then
    echo -e "${GREEN}✓ Integration tests passed${NC}"
else
    echo -e "${RED}❌ Integration tests failed${NC}"
    exit 1
fi
echo ""

# Syntax check
echo "📝 Checking code syntax..."
if node --check src/*.js test/*.js 2>/dev/null; then
    echo -e "${GREEN}✓ Syntax check passed${NC}"
else
    echo -e "${RED}❌ Syntax errors found${NC}"
    exit 1
fi
echo ""

# Summary
echo "================================"
echo -e "${GREEN}✅ All tests passed!${NC}"
echo "================================"
echo ""
echo "Test coverage:"
echo "  • Encoding/decoding"
echo "  • Feed management"
echo "  • Message validation"
echo "  • P2P networking"
echo "  • Multi-user replication"
echo "  • Real-time sync"
echo ""
