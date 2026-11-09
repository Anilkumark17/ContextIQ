import axios from 'axios'

// Vite proxies /api to the Express server, so the httpOnly cookie stays same-origin.
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

export const errorMessage = (error, fallback = 'Something went wrong') =>
  error?.response?.data?.message ?? fallback
