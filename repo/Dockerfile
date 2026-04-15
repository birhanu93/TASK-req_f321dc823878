FROM node:20-alpine

WORKDIR /app

# Copy package files first for layer caching
COPY package.json ./

# Install dependencies
RUN npm install

# Copy all source and test files
COPY . .

# Run tests
CMD ["npm", "test"]
