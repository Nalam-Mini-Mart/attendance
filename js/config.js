// js/config.js - Firebase Modular SDK Configuration

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  writeBatch 
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyANGQ-WvAiFxVEM5rixAgy5LCL4KdIsDCo",
  authDomain: "nalam-attendance.firebaseapp.com",
  projectId: "nalam-attendance",
  storageBucket: "nalam-attendance.firebasestorage.app",
  messagingSenderId: "609798072820",
  appId: "1:609798072820:web:b5bdf65fcef37d3bb9f1a1"
};

// Initialize Primary Firebase Application
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Application Constants
export const APP_CONFIG = {
  shopName: "Nalam Payroll & Ledger",
  currency: "₹"
};

// Re-export SDK functions
export {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch
};
