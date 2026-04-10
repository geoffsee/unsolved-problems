#!/bin/bash

# Exit on error
set -e

echo "--- Building Unsolved Problems Explorer ---"

# Step 1: Install root dependencies (required for data fetching scripts)
echo "Installing root dependencies..."
npm install

# Step 2: Fetch and prepare data
# These scripts populate public/data/
echo "Fetching fresh data from Wikipedia and GDELT..."
npm run fetch-data
npm run fetch-news
npm run enrich-data

# Step 3: Sync data to apps/client/public
# Vike app expects data in its own public folder
echo "Syncing data to apps/client/public..."
mkdir -p apps/client/public
cp -r public/* apps/client/public/

# Step 4: Build the Vike application
# With prerender: true in +config.ts, this will generate a static site
echo "Building Vike application (apps/client)..."
cd apps/client
npm install
npm run build

echo ""
echo "--- Build successful! ---"
echo "The static site is generated in apps/client/dist/client"
