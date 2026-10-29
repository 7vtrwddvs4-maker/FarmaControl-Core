import { initializeApp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js";
import { getFirestore, collection, doc, updateDoc, addDoc, setDoc, getDoc, serverTimestamp, query, where, getDocs, arrayUnion } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js";

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
window.db = db;

// 2. MOTOR DE SEGURIDAD Y CIFRADO (AES-256 / SHA-256)
const CLAVE_MAESTRA = "FarmaControl_HospitalElPino_2026_Secreta!";

window.cifrarDato = function(textoSensible) {
    if (!textoSensible) return "";
    return CryptoJS.AES.encrypt(String(textoSensible), CLAVE_MAESTRA).toString();
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

// 3. GUARDAR NUEVA DISPENSACIÓN EN FIREBASE
window.guardarDispensacionFirebase = async function(item, modulo) {
    try {
        const rutHash = window.generarHashRut(item.rut);
        const rutCifrado = window.cifrarDato(item.rut);
        const pacienteCifrado = window.cifrarDato(item.paciente);
        const medicoCifrado = item.medicoTratante ? window.cifrarDato(item.medicoTratante) : "";
        const rutMedicoCifrado = item.rutMedico ? window.cifrarDato(item.rutMedico) : "";
        const diagnosticoCifrado = item.diagnostico ? window.cifrarDato(item.diagnostico) : "";

        const documentoSeguro = {
            ...item,
            paciente: pacienteCifrado,
            rut_id: rutHash,        // Hash determinista para indexación y búsquedas
            rutCifrado: rutCifrado, // RUT cifrado con AES para visualización local
            medicoTratante: medicoCifrado,
            rutMedico: rutMedicoCifrado,
            diagnostico: diagnosticoCifrado,
            modulo: modulo,
            fechaRegistroNube: serverTimestamp()
        };

        delete documentoSeguro.rut; // Jamás viaja el RUT en texto plano

        const docRef = await addDoc(collection(window.db, "tratamientos"), documentoSeguro);
        return { exito: true, id: docRef.id };
    } catch (error) {
        console.error("Error al guardar en Firebase:", error);
        return { exito: false, error: error.message };
    }
};

// 4. ACTUALIZAR (EDITAR) REGISTRO EN FIREBASE
window.actualizarDispensacionFirebase = async function(item, modulo, docId) {
    try {
        const rutHash = window.generarHashRut(item.rut);
        const rutCifrado = window.cifrarDato(item.rut);
        const pacienteCifrado = window.cifrarDato(item.paciente);
        const medicoCifrado = item.medicoTratante ? window.cifrarDato(item.medicoTratante) : "";
        const rutMedicoCifrado = item.rutMedico ? window.cifrarDato(item.rutMedico) : "";
        const diagnosticoCifrado = item.diagnostico ? window.cifrarDato(item.diagnostico) : "";

        const documentoActualizado = {
            ...item,
            paciente: pacienteCifrado,
            rut_id: rutHash,
            rutCifrado: rutCifrado,
            medicoTratante: medicoCifrado,
            rutMedico: rutMedicoCifrado,
            diagnostico: diagnosticoCifrado,
            modulo: modulo
        };

        delete documentoActualizado.rut;

        const docRef = doc(window.db, "tratamientos", docId);
        await updateDoc(docRef, documentoActualizado);
        return { exito: true, id: docId };
    } catch (error) {
        console.error("Error al actualizar en Firebase:", error);
        return { exito: false, error: error.message };
    }
};

// 5. OBTENER Y DESCIFRAR REGISTROS (CON AGRUPADOR CLÍNICO DE ALBÚMINA)
window.obtenerRegistrosFirebase = async function(modulo) {
    try {
        const q = query(collection(window.db, "tratamientos"), where("modulo", "==", modulo));
        const snapshot = await getDocs(q);
        let datosCrudos = [];
        
        snapshot.forEach((docSnap) => {
            let item = docSnap.data();
            item.id = docSnap.id;
            item.filaReal = docSnap.id; // Compatibilidad directa con prepararEdicion()
            
            // Descifrado en memoria RAM local
            item.paciente = item.paciente ? window.descifrarDato(item.paciente) : "SIN NOMBRE";
            item.rut = item.rutCifrado ? window.descifrarDato(item.rutCifrado) : "S/RUT";
            item.medicoTratante = item.medicoTratante ? window.descifrarDato(item.medicoTratante) : "";
            item.rutMedico = item.rutMedico ? window.descifrarDato(item.rutMedico) : "";
            item.diagnostico = item.diagnostico ? window.descifrarDato(item.diagnostico) : "";
            
            // Compatibilidad de campos con el renderizador HTML
            item.fechaDisp = item.fechaDispensacion || "";
            item.dosisDiaria = item.dosisDiarias || item.dosisDiaria || 0;
            
            datosCrudos.push(item);
        });

        // Ordenar por fecha de dispensación (más recientes primero)
        datosCrudos.sort((a, b) => new Date(b.fechaDisp) - new Date(a.fechaDisp));

        // Si es Albúmina, agrupamos los despachos por paciente/diagnóstico para armar el historial
        if (modulo === "Albumina") {
            let mapaAlbumina = {};
            [...datosCrudos].reverse().forEach(reg => {
                let clave = `${reg.rut_id}_${reg.diagnostico}`;
                if (!mapaAlbumina[clave]) {
                    mapaAlbumina[clave] = {
                        ...reg,
                        frascosAcumulados: 0,
                        diasTratamiento: 0,
                        ciclo: 1,
                        historial: []
                    };
                }
                let grupo = mapaAlbumina[clave];
                let cantFrascos = Number(reg.frascos) || 0;
                grupo.frascosAcumulados += cantFrascos;
                grupo.diasTratamiento += 1;
                grupo.fechaDisp = reg.fechaDisp;
                grupo.servicio = reg.servicio;
                grupo.historial.push({
                    fecha: reg.fechaDisp.split("-").reverse().join("/"),
                    frascos: cantFrascos,
                    medico: reg.medicoTratante,
                    digitador: reg.digitador
                });
            });
            return { exito: true, datos: Object.values(mapaAlbumina).reverse() };
        }
        
        return { exito: true, datos: datosCrudos };
    } catch (error) {
        console.error("Error al descargar de Firestore:", error);
        return { exito: false, error: error.message };
    }
};

// 6. MOTOR ESTADÍSTICO PARA INFORMES CLÍNICOS A4 (DESDE FIREBASE)
window.obtenerEstadisticasFirebase = async function(modulo, filtroSrv = "TODOS", filtroTiempo = "ANUAL", filtroAnio = "") {
    try {
        const q = query(collection(window.db, "tratamientos"), where("modulo", "==", modulo));
        const snapshot = await getDocs(q);

        let anioTarget = filtroAnio ? parseInt(filtroAnio, 10) : new Date().getFullYear();
        let totalKPI = 0;
        let diagCount = {};
        let mesesCount = {};
        let tempPacientes = {};

        snapshot.forEach((docSnap) => {
            let item = docSnap.data();
            let nomPac = item.paciente ? window.descifrarDato(item.paciente).trim().toUpperCase() : "SIN NOMBRE";
            let rutPac = item.rutCifrado ? window.descifrarDato(item.rutCifrado).trim().toUpperCase() : "S/RUT";
            let servicio = item.servicio ? String(item.servicio).trim() : "Sin Servicio";
            
            if (filtroSrv !== "TODOS" && servicio.toUpperCase() !== String(filtroSrv).trim().toUpperCase()) return;

            let categoria = modulo === "Albumina" 
                ? (item.diagnostico ? window.descifrarDato(item.diagnostico).trim() : "Sin Diagnóstico")
                : (item.medicamento ? String(item.medicamento).trim() : "Sin Medicamento");

            let cantidad = modulo === "Albumina" ? (Number(item.frascos) || 0) : 1;
            let strF = String(item.fechaDispensacion || "").trim();
            if (!strF) return;

            let p = strF.split(/[-/]/);
            if (p.length !== 3) return;
            let d = (p[0].length === 4) ? new Date(p[0], p[1] - 1, p[2]) : new Date(p[2], p[1] - 1, p[0]);
            if (isNaN(d.getTime())) return;

            let m = d.getMonth() + 1;
            let y = d.getFullYear();
            let mesKey = y + "-" + String(m).padStart(2, '0');

            if (!mesesCount[mesKey]) mesesCount[mesKey] = 0;
            mesesCount[mesKey] += cantidad;

            let entraEnTiempo = false;
            if (y === anioTarget) {
                if (filtroTiempo === "ANUAL") entraEnTiempo = true;
                else if (filtroTiempo === "T1" && m >= 1 && m <= 3) entraEnTiempo = true;
                else if (filtroTiempo === "T2" && m >= 4 && m <= 6) entraEnTiempo = true;
                else if (filtroTiempo === "T3" && m >= 7 && m <= 9) entraEnTiempo = true;
                else if (filtroTiempo === "T4" && m >= 10 && m <= 12) entraEnTiempo = true;
                else if (parseInt(filtroTiempo, 10) === m) entraEnTiempo = true;
            }

            if (entraEnTiempo) {
                totalKPI += cantidad;
                if (!diagCount[categoria]) diagCount[categoria] = 0;
                diagCount[categoria] += cantidad;

                if (!tempPacientes[servicio]) tempPacientes[servicio] = {};
                if (!tempPacientes[servicio][rutPac]) {
                    tempPacientes[servicio][rutPac] = { nombre: nomPac, total: 0 };
                }
                tempPacientes[servicio][rutPac].total += cantidad;
            }
        });

        let sortedMeses = Object.keys(mesesCount).sort();
        let labelsMeses = sortedMeses.map(k => {
            let [yy, mm] = k.split("-");
            return ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][parseInt(mm, 10) - 1] + " " + yy;
        });

        let listadoPacientes = {};
        for (let s in tempPacientes) {
            listadoPacientes[s] = Object.keys(tempPacientes[s]).map(r => ({
                rut: r,
                nombre: tempPacientes[s][r].nombre,
                total: tempPacientes[s][r].total
            }));
        }

        return {
            exito: true,
            kpiActual: totalKPI,
            kpiVar: filtroSrv === "TODOS" ? "NIVEL HOSPITAL" : filtroSrv,
            labelsTendencia: labelsMeses,
            dataTendencia: sortedMeses.map(k => mesesCount[k]),
            labelsDiag: Object.keys(diagCount),
            dataDiag: Object.keys(diagCount).map(k => diagCount[k]),
            pacientes: listadoPacientes
        };
    } catch (e) {
        return { exito: false, error: e.toString() };
    }
};

// 7. OBTENER DATOS MAESTROS DE FIREBASE (CON DESCIFRADO DE MÉDICOS)
window.obtenerDatosMaestrosFirebase = async function() {
    try {
        const docRef = doc(window.db, "configuracion", "maestros");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            let datos = docSnap.data();
            
            // Desciframos la lista de médicos localmente en memoria RAM
            if (datos.medicosAlbumina) {
                datos.medicosAlbumina = datos.medicosAlbumina.map(med => ({
                    rut: window.descifrarDato(med.rut),
                    nombre: window.descifrarDato(med.nombre)
                }));
            }
            return { exito: true, ...datos };
        } else {
            return { exito: false, error: "No se encontró el documento de configuración." };
        }
    } catch (error) {
        console.error("Error al descargar maestros:", error);
        return { exito: false, error: error.message };
    }
};

// 8. GUARDAR MÉDICO NUEVO AUTOMÁTICAMENTE EN MAESTROS (CIFRADO AES-256)
window.agregarMedicoMaestroFirebase = async function(nombreLimpio, rutLimpio) {
    try {
        const docRef = doc(window.db, "configuracion", "maestros");
        const nuevoMedicoCifrado = {
            nombre: window.cifrarDato(nombreLimpio.trim().toUpperCase()),
            rut: window.cifrarDato(rutLimpio.trim().toUpperCase())
        };
        await updateDoc(docRef, {
            medicosAlbumina: arrayUnion(nuevoMedicoCifrado)
        });
        console.log("Médico nuevo aprendido y cifrado en maestros:", nombreLimpio);
        return { exito: true };
    } catch (error) {
        console.error("Error al guardar médico nuevo en maestros:", error);
        return { exito: false, error: error.message };
    }
};

// Avisar al HTML si Firebase ya estaba esperando
if (window.moduloPendienteCarga) {
    window.obtenerRegistrosFirebase(window.moduloPendienteCarga).then(res => window.renderizarTabla(res));
}