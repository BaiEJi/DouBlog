import api from './api';

export const login = () => {
  return api.post('/auth/login');
};

export const checkAuth = () => {
  return api.get('/auth/check');
};
