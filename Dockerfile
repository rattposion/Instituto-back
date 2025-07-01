FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# (Opcional) Remove dependências de desenvolvimento para imagem final menor
RUN npm prune --production

# Create logs directory
RUN mkdir -p logs

# Start the application
CMD ["npm", "start"]
