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
      MINIO_PUBLIC_URL: string;

      GOOGLE_CLIENT_ID: string;
      GOOGLE_CLIENT_SECRET: string;
      GOOGLE_REDIRECT_URI: string;
    }
  }
}

export {};
