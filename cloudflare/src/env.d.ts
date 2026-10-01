// Cross-Worker RPC requires an explicit entrypoint type; all other bindings are generated.
type Env = Omit<WorkerBindings, 'SIMULATOR'> & {
  SIMULATOR: Service<import('./simulator').Simulator>;
};
