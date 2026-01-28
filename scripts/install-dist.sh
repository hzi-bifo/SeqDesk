#!/bin/bash
#
# SeqDesk Installation Script
# https://seqdesk.com
#
# Usage: curl -fsSL https://seqdesk.com/install.sh | bash
#
# Options (environment variables):
#   SEQDESK_DIR=/path     - Installation directory (default: ./seqdesk)
#   SEQDESK_VERSION=x.x.x - Specific version (default: latest)
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Config
SEQDESK_DIR="${SEQDESK_DIR:-./seqdesk}"
SEQDESK_API="https://seqdesk.com/api"

# Spinner function
spin() {
    local pid=$1
    local delay=0.1
    local spinstr='|/-\'
    while ps -p $pid > /dev/null 2>&1; do
        local temp=${spinstr#?}
        printf " [%c]  " "$spinstr"
        local spinstr=$temp${spinstr%"$temp"}
        sleep $delay
        printf "\b\b\b\b\b\b"
    done
    printf "      \b\b\b\b\b\b"
}

# Progress bar function
progress_bar() {
    local current=$1
    local total=$2
    local width=40
    local percent=$((current * 100 / total))
    local filled=$((current * width / total))
    local empty=$((width - filled))

    printf "\r  ["
    printf "%${filled}s" | tr ' ' '#'
    printf "%${empty}s" | tr ' ' '-'
    printf "] %3d%%" $percent
}

echo ""
echo -e "${BLUE}"
echo "  ____             ____            _    "
echo " / ___|  ___  __ _|  _ \  ___  ___| | __"
echo " \___ \ / _ \/ _\` | | | |/ _ \/ __| |/ /"
echo "  ___) |  __/ (_| | |_| |  __/\__ \   < "
echo " |____/ \___|\__, |____/ \___|___/_|\_\\"
echo "                |_|                      "
echo -e "${NC}"
echo ""

# Check dependencies
echo -e "${BLUE}Checking dependencies...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is required but not installed.${NC}"
    echo "Install Node.js 18+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js 18+ is required (found v$NODE_VERSION)${NC}"
    exit 1
fi
echo -e "${GREEN}[OK]${NC} Node.js $(node -v)"

if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is required but not installed.${NC}"
    exit 1
fi
echo -e "${GREEN}[OK]${NC} npm $(npm -v)"

# Get latest version info
echo ""
echo -ne "${BLUE}Fetching latest version...${NC}"

VERSION_INFO=$(curl -fsSL "$SEQDESK_API/version" 2>/dev/null) || {
    echo -e "\r${RED}Error: Could not connect to SeqDesk server${NC}"
    exit 1
}

LATEST_VERSION=$(echo "$VERSION_INFO" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
DOWNLOAD_URL=$(echo "$VERSION_INFO" | grep -o '"downloadUrl":"[^"]*"' | head -1 | cut -d'"' -f4)
CHECKSUM=$(echo "$VERSION_INFO" | grep -o '"checksum":"[^"]*"' | head -1 | cut -d'"' -f4)
FILE_SIZE=$(echo "$VERSION_INFO" | grep -o '"size":[0-9]*' | head -1 | cut -d':' -f2)

if [ -z "$LATEST_VERSION" ] || [ -z "$DOWNLOAD_URL" ]; then
    echo -e "\r${RED}Error: Could not fetch version info${NC}"
    exit 1
fi

echo -e "\r${GREEN}[OK]${NC} Latest version: ${CYAN}$LATEST_VERSION${NC}              "

# Download with progress
echo ""
echo -e "${BLUE}Downloading SeqDesk $LATEST_VERSION...${NC}"

TEMP_FILE=$(mktemp)

# Use curl with progress bar
if [ -n "$FILE_SIZE" ] && [ "$FILE_SIZE" -gt 0 ]; then
    SIZE_MB=$((FILE_SIZE / 1024 / 1024))
    echo -e "  File size: ${CYAN}${SIZE_MB}MB${NC}"
fi

# Download with progress indicator
curl -fL "$DOWNLOAD_URL" -o "$TEMP_FILE" --progress-bar 2>&1 | \
    stdbuf -oL tr '\r' '\n' | \
    while IFS= read -r line; do
        # Parse curl progress and show custom progress
        if [[ "$line" =~ ([0-9]+)\.([0-9]+)% ]]; then
            percent="${BASH_REMATCH[1]}"
            printf "\r  Downloading: [%-40s] %3d%%" "$(printf '#%.0s' $(seq 1 $((percent * 40 / 100))))" "$percent"
        fi
    done

# Fallback: just show that download completed
if [ ! -s "$TEMP_FILE" ]; then
    echo -e "\r${RED}Error: Download failed${NC}"
    rm -f "$TEMP_FILE"
    exit 1
fi

echo -e "\r  Downloading: [########################################] 100%"
echo -e "${GREEN}[OK]${NC} Downloaded successfully"

# Verify checksum if provided
if [ -n "$CHECKSUM" ]; then
    echo -ne "${BLUE}Verifying checksum...${NC}"
    if command -v sha256sum &> /dev/null; then
        ACTUAL_CHECKSUM=$(sha256sum "$TEMP_FILE" | cut -d' ' -f1)
    else
        ACTUAL_CHECKSUM=$(shasum -a 256 "$TEMP_FILE" | cut -d' ' -f1)
    fi

    if [ "$ACTUAL_CHECKSUM" = "$CHECKSUM" ]; then
        echo -e "\r${GREEN}[OK]${NC} Checksum verified                    "
    else
        echo -e "\r${RED}Error: Checksum mismatch${NC}"
        echo "  Expected: $CHECKSUM"
        echo "  Got:      $ACTUAL_CHECKSUM"
        rm -f "$TEMP_FILE"
        exit 1
    fi
fi

# Extract
echo -e "${BLUE}Installing to $SEQDESK_DIR...${NC}"

if [ -d "$SEQDESK_DIR" ]; then
    echo -ne "${YELLOW}Directory exists. Backup and replace? [y/N]: ${NC}"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        rm -f "$TEMP_FILE"
        exit 0
    fi
    # Backup existing
    mv "$SEQDESK_DIR" "${SEQDESK_DIR}.backup.$(date +%Y%m%d%H%M%S)"
fi

mkdir -p "$SEQDESK_DIR"
tar -xzf "$TEMP_FILE" -C "$SEQDESK_DIR" --strip-components=1
rm "$TEMP_FILE"

echo -e "${GREEN}[OK]${NC} Extracted"

# Setup
cd "$SEQDESK_DIR"

# Create .env if not exists
if [ ! -f ".env" ]; then
    cp .env.example .env
    SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=\"$SECRET\"|" .env
    else
        sed -i "s|NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=\"$SECRET\"|" .env
    fi
    echo -e "${GREEN}[OK]${NC} Created .env with generated secret"
fi

# Initialize database
echo -ne "${BLUE}Initializing database...${NC}"
npx prisma db push --skip-generate > /dev/null 2>&1 || {
    echo -e "\r${RED}Error: Database initialization failed${NC}"
    exit 1
}
echo -e "\r${GREEN}[OK]${NC} Database initialized              "

# Done
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  SeqDesk $LATEST_VERSION installed successfully!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "To start SeqDesk:"
echo ""
echo -e "  ${CYAN}cd $SEQDESK_DIR${NC}"
echo -e "  ${CYAN}./start.sh${NC}"
echo ""
echo "Then open http://localhost:3000"
echo ""
echo "Default login:"
echo "  Email:    admin@example.com"
echo "  Password: admin"
echo ""
