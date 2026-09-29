declare const __BUILD_TIME__: string;
declare const __GIT_COMMIT__: string;
declare const __DEPLOY_ENV__: string;

export const BUILD_META = {
  builtAt: __BUILD_TIME__,
  commit: __GIT_COMMIT__,
  environment: __DEPLOY_ENV__
};

export const shortCommit = BUILD_META.commit && BUILD_META.commit !== 'local'
  ? BUILD_META.commit.slice(0, 7)
  : 'local';
