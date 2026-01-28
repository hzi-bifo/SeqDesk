#!/bin/bash
cd "$(dirname "$0")"

if [ ! -f ".env" ]; then
    cp .env.example .env
    SECRET=$(openssl rand -base64 32)
    sed -i.bak "s|NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=\"$SECRET\"|" .env && rm -f .env.bak
    echo "Created .env with generated secret"
fi

if [ "$1" = "--init" ]; then
    npx prisma db push --skip-generate
    npx prisma db seed
    echo "Database initialized"
fi

export NODE_ENV=production
node server.js
