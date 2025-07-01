FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Gerar Prisma Client
RUN npx prisma generate

# Build the application
RUN npm run build

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --spider -q http://localhost:3001/health || exit 1

# Rodar migrações e iniciar a aplicação
CMD npx prisma migrate deploy && npm start