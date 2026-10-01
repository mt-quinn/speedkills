// Cross-Worker RPC requires an explicit entrypoint type; all other bindings are generated.
type Env = Omit<WorkerBindings, 'SIMULATOR' | 'PREPARATIONS'> & {
  SIMULATOR: Service<import('./simulator').Simulator>;
  PREPARATIONS: Queue<{ jobId: string }>;
  AUTH_SECRET: string;
  AUTH_RESEND_KEY?: string;
  AUTH_EMAIL_FROM?: string;
};
