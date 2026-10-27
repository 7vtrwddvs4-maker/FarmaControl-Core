// 🛡️ MOTOR DE SEGURIDAD Y CIFRADO (AES-256 / SHA-256)
// ADVERTENCIA: En un entorno de producción estricto, esta clave se inyecta por variables de entorno (.env).
const CLAVE_MAESTRA = "FarmaControl_HospitalElPino_2026_Secreta!";

// 1. Cifrar textos (Nombres, Apellidos, Diagnósticos)
function cifrarDato(textoSensible) {
    if (!textoSensible) return "";
    return CryptoJS.AES.encrypt(textoSensible, CLAVE_MAESTRA).toString();
}

// 2. Descifrar textos (Al descargar los datos desde Firebase para mostrarlos en pantalla)
function descifrarDato(textoCifrado) {
    if (!textoCifrado) return "";
    try {
        const bytes = CryptoJS.AES.decrypt(textoCifrado, CLAVE_MAESTRA);
        return bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) {
        return "[Error de Descifrado]";
    }
}

// 3. Hash Determinista para el RUT (Transforma el RUT en un ID fijo irreconocible para buscar pacientes)
function generarHashRut(rut) {
    if (!rut) return "";
    let rutLimpio = String(rut).replace(/[^0-9Kk]/g, '').toUpperCase();
    return CryptoJS.SHA256(rutLimpio).toString(CryptoJS.enc.Hex);
}
