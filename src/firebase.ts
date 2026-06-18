import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyBvg2av881ZTi9op-bzwicL70vh2UENItw',
  authDomain: 'horugva-ff8bd.firebaseapp.com',
  databaseURL: 'https://horugva-ff8bd-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'horugva-ff8bd',
  storageBucket: 'horugva-ff8bd.firebasestorage.app',
  messagingSenderId: '1011491870660',
  appId: '1:1011491870660:web:e02210da9c21bb38a5b691',
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
