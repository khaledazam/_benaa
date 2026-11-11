import axios from "axios";
import Cookies from "js-cookie";

const axiosInstance = axios.create({
  // This Next.js client authenticates with its own server. Never send employee
  // credentials or bearer tokens to an unrelated legacy deployment.
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true, // Ensure cookies are sent with requests
});

axiosInstance.interceptors.request.use((config) => {
  const token = Cookies.get("session_id");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default axiosInstance;
