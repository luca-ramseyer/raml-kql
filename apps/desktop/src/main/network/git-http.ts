import type { HttpClient } from 'isomorphic-git';
import { request } from 'isomorphic-git/http/node';

import { recordNetwork } from './network-activity';

/** isomorphic-git's Node HTTP client, recording each request's host (Network Activity). */
export const gitHttp: HttpClient = {
  request: (options) => {
    recordNetwork(options.url, 'git');
    return request(options);
  },
};
