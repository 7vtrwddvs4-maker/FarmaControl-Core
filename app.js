import { initializeApp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js";

// 1. CONEXIÓN A FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyBkaBu8l0vt_1-2Wgx5YibJZR2fV1TaS2M",
  authDomain: "farmacontrol-13cf4.firebaseapp.com",
  projectId: "farmacontrol-13cf4",
  storageBucket: "farmacontrol-13cf4.firebasestorage.app",
  messagingSenderId: "555722785930",
  appId: "1:555722785930:web:49f05ed8b27aef27be1973"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
window.db = db; // Expone la base de datos globalmente

// 2. MOTOR DE SEGURIDAD Y CIFRADO (AES-256 / SHA-256)
const CLAVE_MAESTRA = "FarmaControl_HospitalElPino_2026_Secreta!";

window.cifrarDato = function(textoSensible) {
    if (!textoSensible) return "";
    return CryptoJS.AES.encrypt(textoSensible, CLAVE_MAESTRA).toString();
};

window.descifrarDato = function(textoCifrado) {
    if (!textoCifrado) return "";
    try {
        const bytes = CryptoJS.AES.decrypt(textoCifrado, CLAVE_MAESTRA);
        return bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) {
        return "[Error de Descifrado]";
    }
};

window.generarHashRut = function(rut) {
    if (!rut) return "";
    let rutLimpio = String(rut).replace(/[^0-9Kk]/g, '').toUpperCase();
    return CryptoJS.SHA256(rutLimpio).toString(CryptoJS.enc.Hex);
};

// 3. FUNCIÓN PARA GUARDAR EN FIREBASE (REEMPLAZA A GOOGLE APPS SCRIPT)
window.guardarDispensacionFirebase = async function(item, modulo) {
    try {
        // 1. Cifrado de grado militar para proteger la Ley 19.628
        const rutHash = window.generarHashRut(item.rut);
        const pacienteCifrado = window.cifrarDato(item.paciente);
        
        // Encriptamos médico y diagnóstico solo si existen en el módulo actual
        const medicoCifrado = item.medicoTratante ? window.cifrarDato(item.medicoTratante) : "";
        const diagnosticoCifrado = item.diagnostico ? window.cifrarDato(item.diagnostico) : "";

        // 2. Ensamblar el documento seguro
        const documentoSeguro = {
            ...item, // Copia los datos inofensivos (fechas, servicio, medicamento, frascos, dosis)
            paciente: pacienteCifrado,
            rut_id: rutHash, // Usamos el Hash como identificador
            medicoTratante: medicoCifrado,
            diagnostico: diagnosticoCifrado,
            modulo: modulo,
            fechaRegistroNube: serverTimestamp() // Hora exacta e inalterable del servidor de Google
        };

        // 3. Destruir el RUT original en texto plano antes de que viaje a internet
        delete documentoSeguro.rut;

        // 4. Inyectar el documento en la base de datos Firestore
        const docRef = await addDoc(collection(window.db, "tratamientos"), documentoSeguro);
        
        console.log("Documento encriptado y guardado con éxito. ID:", docRef.id);
        return { exito: true, id: docRef.id };

    } catch (error) {
        console.error("Error crítico de Firebase:", error);
        return { exito: false, error: error.message };
    }
};
