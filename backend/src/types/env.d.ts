declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_URL: string;
      JWT_SECRET: string;

      MINIO_ENDPOINT: string;
      MINIO_PORT: string;
      MINIO_USE_SSL: string;
      MINIO_ACCESS_KEY: string;
      MINIO_SECRET_KEY: string;
      MINIO_BUCKET: string;

      GOOGLE_CLIENT_ID: string;
      GOOGLE_CLIENT_SECRET: string;
      GOOGLE_REDIRECT_URI: string;
      FRONTEND_URL: string;

      REDIS_HOSTNAME: string;
      REDIS_PORT: string;
      REDIS_PASSWORD: string;
    }
  }
}

export {};
