FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Instala todas as dependências (incluindo dev)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove dependências de desenvolvimento após o build
RUN npm prune --production

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start the application
CMD ["npm", "start"]
