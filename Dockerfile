FROM node:20.16.0-slim as base

# Node.js app lives here
WORKDIR /usr/src/app

# Set production environment
ENV NODE_ENV="production"

# Throw-away build stage to reduce size of final image
FROM base as build

# Install node modules
COPY --link package-lock.json package.json ./

RUN npm ci --include=dev

# Copy application code
COPY --link . .

# Build application
RUN npm run build

# Remove development dependencies
RUN npm prune --omit=dev

# Final stage for app image
FROM base

# Copy built application
COPY --from=build /usr/src/app /usr/src/app

CMD [ "node", "dist/app.js" ]
