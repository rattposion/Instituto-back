# Dockerfile para backend Node.js + Prisma
FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm install

COPY . .

# Gera o Prisma Client durante o build
RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "start"] 
