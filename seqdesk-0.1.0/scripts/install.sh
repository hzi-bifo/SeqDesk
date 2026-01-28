#!/bin/bash
#
# SeqDesk Installation Script
# Usage: curl -fsSL https://seqdesk.com/install.sh | bash
#
# Options:
#   SEQDESK_DIR=/path/to/install  - Installation directory (default: ./seqdesk)
#   SEQDESK_BRANCH=main           - Git branch to install (default: main)
#   SEQDESK_SKIP_DEPS=1           - Skip dependency checks
#   SEQDESK_WITH_CONDA=1          - Also install Miniconda
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SEQDESK_REPO="https://github.com/hzi-bifo/SeqDesk.git"
SEQDESK_DIR="${SEQDESK_DIR:-./seqdesk}"
SEQDESK_BRANCH="${SEQDESK_BRANCH:-main}"
MIN_NODE_VERSION=18

# Helper functions
print_header() {
    echo ""
    echo -e "${BLUE}======================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}======================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

version_ge() {
    # Returns 0 if $1 >= $2
    [ "$(printf '%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

# Banner
echo ""
echo -e "${BLUE}"
echo "  ____             ____            _    "
echo " / ___|  ___  __ _|  _ \  ___  ___| | __"
echo " \___ \ / _ \/ _\` | | | |/ _ \/ __| |/ /"
echo "  ___) |  __/ (_| | |_| |  __/\__ \   < "
echo " |____/ \___|\__, |____/ \___||___/_|\_\\"
echo "                |_|                      "
echo -e "${NC}"
echo "  Sequencing Facility Management System"
echo "  https://seqdesk.com"
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    print_warning "Running as root. Consider running as a regular user."
fi

# System detection
print_header "Detecting System"

OS="unknown"
ARCH=$(uname -m)

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    if [ -f /etc/debian_version ]; then
        DISTRO="debian"
    elif [ -f /etc/redhat-release ]; then
        DISTRO="redhat"
    else
        DISTRO="unknown"
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
    DISTRO="macos"
else
    print_error "Unsupported operating system: $OSTYPE"
    exit 1
fi

print_success "OS: $OS ($DISTRO)"
print_success "Architecture: $ARCH"

# Check dependencies
print_header "Checking Dependencies"

MISSING_DEPS=()

# Check Git
if command_exists git; then
    GIT_VERSION=$(git --version | cut -d' ' -f3)
    print_success "Git: $GIT_VERSION"
else
    MISSING_DEPS+=("git")
    print_error "Git: not found"
fi

# Check Node.js
if command_exists node; then
    NODE_VERSION=$(node --version | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge "$MIN_NODE_VERSION" ]; then
        print_success "Node.js: $NODE_VERSION"
    else
        print_error "Node.js: $NODE_VERSION (requires >= $MIN_NODE_VERSION)"
        MISSING_DEPS+=("node")
    fi
else
    MISSING_DEPS+=("node")
    print_error "Node.js: not found"
fi

# Check npm
if command_exists npm; then
    NPM_VERSION=$(npm --version)
    print_success "npm: $NPM_VERSION"
else
    MISSING_DEPS+=("npm")
    print_error "npm: not found"
fi

# Optional: Check Conda
if command_exists conda; then
    CONDA_VERSION=$(conda --version | cut -d' ' -f2)
    print_success "Conda: $CONDA_VERSION (optional)"
else
    print_info "Conda: not found (optional, needed for pipelines)"
fi

# Optional: Check Nextflow
if command_exists nextflow; then
    NF_VERSION=$(nextflow -version 2>&1 | grep -oP 'version \K[0-9.]+' || echo "unknown")
    print_success "Nextflow: $NF_VERSION (optional)"
else
    print_info "Nextflow: not found (optional, needed for pipelines)"
fi

# Handle missing dependencies
if [ ${#MISSING_DEPS[@]} -gt 0 ] && [ -z "$SEQDESK_SKIP_DEPS" ]; then
    print_header "Installing Missing Dependencies"

    for dep in "${MISSING_DEPS[@]}"; do
        case $dep in
            node|npm)
                print_info "Installing Node.js..."
                if [[ "$OS" == "macos" ]]; then
                    if command_exists brew; then
                        brew install node
                    else
                        print_error "Please install Homebrew first: https://brew.sh"
                        exit 1
                    fi
                elif [[ "$DISTRO" == "debian" ]]; then
                    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
                    sudo apt-get install -y nodejs
                elif [[ "$DISTRO" == "redhat" ]]; then
                    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
                    sudo yum install -y nodejs
                else
                    print_error "Please install Node.js manually: https://nodejs.org"
                    exit 1
                fi
                ;;
            git)
                print_info "Installing Git..."
                if [[ "$OS" == "macos" ]]; then
                    xcode-select --install 2>/dev/null || brew install git
                elif [[ "$DISTRO" == "debian" ]]; then
                    sudo apt-get update && sudo apt-get install -y git
                elif [[ "$DISTRO" == "redhat" ]]; then
                    sudo yum install -y git
                fi
                ;;
        esac
    done

    print_success "Dependencies installed"
fi

# Install Miniconda if requested
if [ -n "$SEQDESK_WITH_CONDA" ] && ! command_exists conda; then
    print_header "Installing Miniconda"

    CONDA_INSTALLER="Miniconda3-latest-Linux-x86_64.sh"
    if [[ "$OS" == "macos" ]]; then
        if [[ "$ARCH" == "arm64" ]]; then
            CONDA_INSTALLER="Miniconda3-latest-MacOSX-arm64.sh"
        else
            CONDA_INSTALLER="Miniconda3-latest-MacOSX-x86_64.sh"
        fi
    fi

    print_info "Downloading Miniconda..."
    curl -fsSL "https://repo.anaconda.com/miniconda/$CONDA_INSTALLER" -o /tmp/miniconda.sh

    print_info "Installing Miniconda to ~/miniconda3..."
    bash /tmp/miniconda.sh -b -p "$HOME/miniconda3"
    rm /tmp/miniconda.sh

    # Initialize conda
    "$HOME/miniconda3/bin/conda" init bash 2>/dev/null || true
    "$HOME/miniconda3/bin/conda" init zsh 2>/dev/null || true

    # Add to current session
    export PATH="$HOME/miniconda3/bin:$PATH"

    print_success "Miniconda installed to ~/miniconda3"
    print_warning "Please restart your shell or run: source ~/.bashrc"
fi

# Clone repository
print_header "Downloading SeqDesk"

if [ -d "$SEQDESK_DIR" ]; then
    print_warning "Directory $SEQDESK_DIR already exists"
    read -p "Overwrite? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$SEQDESK_DIR"
    else
        print_error "Installation cancelled"
        exit 1
    fi
fi

print_info "Cloning repository..."
git clone --branch "$SEQDESK_BRANCH" --depth 1 "$SEQDESK_REPO" "$SEQDESK_DIR"
cd "$SEQDESK_DIR"

print_success "Downloaded to $SEQDESK_DIR"

# Install npm dependencies
print_header "Installing Dependencies"

print_info "Running npm install..."
npm install --silent

print_success "Dependencies installed"

# Setup environment
print_header "Configuring Environment"

if [ ! -f .env ]; then
    cp .env.example .env

    # Generate random secret
    RANDOM_SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)

    # Update .env with generated secret
    if [[ "$OS" == "macos" ]]; then
        sed -i '' "s/NEXTAUTH_SECRET=.*/NEXTAUTH_SECRET=\"$RANDOM_SECRET\"/" .env
    else
        sed -i "s/NEXTAUTH_SECRET=.*/NEXTAUTH_SECRET=\"$RANDOM_SECRET\"/" .env
    fi

    print_success "Created .env with generated secret"
else
    print_info ".env already exists, skipping"
fi

# Setup database
print_header "Setting Up Database"

print_info "Creating database schema..."
npx prisma db push --skip-generate 2>/dev/null

print_info "Seeding initial data..."
npx prisma db seed 2>/dev/null

print_success "Database initialized"

# Create example config
print_header "Creating Configuration"

if [ ! -f seqdesk.config.json ]; then
    cat > seqdesk.config.json << 'CONFIGEOF'
{
  "site": {
    "name": "SeqDesk",
    "dataBasePath": "./data"
  },
  "pipelines": {
    "enabled": false
  }
}
CONFIGEOF
    print_success "Created seqdesk.config.json"
    print_info "Edit this file to customize your installation"
else
    print_info "seqdesk.config.json already exists, skipping"
fi

# Final instructions
print_header "Installation Complete!"

echo -e "${GREEN}SeqDesk has been installed successfully!${NC}"
echo ""
echo "To start the application:"
echo ""
echo -e "  ${BLUE}cd $SEQDESK_DIR${NC}"
echo -e "  ${BLUE}npm run dev${NC}"
echo ""
echo "Then open http://localhost:3000 in your browser."
echo ""
echo "Default login credentials:"
echo "  Admin:      admin@example.com / admin"
echo "  Researcher: user@example.com / user"
echo ""
echo "Next steps:"
echo "  1. Edit seqdesk.config.json to configure your facility"
echo "  2. Run 'npm run setup' to launch the setup wizard (coming soon)"
echo "  3. See docs/installation.md for production deployment"
echo ""
echo -e "Documentation: ${BLUE}https://github.com/hzi-bifo/SeqDesk/tree/main/docs${NC}"
echo -e "Website:       ${BLUE}https://seqdesk.com${NC}"
echo ""
