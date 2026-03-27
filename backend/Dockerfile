FROM public.ecr.aws/docker/library/node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

RUN npx tsc -p tsconfig.json

EXPOSE 3300

CMD ["node", "dist/server.js"]
