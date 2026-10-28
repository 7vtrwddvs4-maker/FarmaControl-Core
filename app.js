import { initializeApp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js";
import { getFirestore, collection, doc, updateDoc, addDoc, setDoc, getDoc, serverTimestamp, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js";

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
            // Recorremos del más antiguo al más nuevo para construir la línea de tiempo
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
                grupo.fechaDisp = reg.fechaDisp; // Muestra la fecha del último despacho
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
        const res = await window.obtenerRegistrosFirebase(modulo === "Albumina" ? " InvalidateGrouping" : modulo);
        // Consultamos directamente todos los documentos individuales del módulo sin agrupar
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

// Avisar al HTML si Firebase ya estaba esperando
if (window.moduloPendienteCarga) {
    window.obtenerRegistrosFirebase(window.moduloPendienteCarga).then(res => window.renderizarTabla(res));
}

// 7. OBTENER DATOS MAESTROS (LISTAS DE SELECCIÓN)
window.obtenerDatosMaestrosFirebase = async function() {
    try {
        const docRef = doc(window.db, "configuracion", "maestros");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return { exito: true, ...docSnap.data() };
        } else {
            return { exito: false, error: "No se encontró el documento de configuración." };
        }
    } catch (error) {
        console.error("Error al descargar maestros:", error);
        return { exito: false, error: error.message };
    }
};

// 8. FUNCIÓN TEMPORAL PARA SUBIR LOS DATOS POR PRIMERA VEZ (Luego la borraremos)
window.subirDatosMaestrosUnaVez = async function() {
    const datosReales = {
        servicios: ["Medicina", "UCI", "UTI", "URG Adulto", "URG Infantil", "Pabellón", "Cirugía", "Pediatría", "Neonatología", "Ginecología"],
        digitadores: ["Francisco Barra", "Susana", "Turno Noche", "Turno Día"],
        inhaladores: [
            {nombre: "Salbutamol 100 mcg", presentacion: 200},
            {nombre: "Bromuro Ipratropio 20 mcg", presentacion: 200},
            {nombre: "Budesonida 200 mcg", presentacion: 120},
            {nombre: "Fluticasona 125 mcg", presentacion: 120},
            {nombre: "Salmeterol / Fluticasona 25/125 mcg", presentacion: 120},
            {nombre: "Salmeterol / Fluticasona 25/250 mcg", presentacion: 120},
            {nombre: "Tiotropio / Olodaterol 2.5/2.5 mcg", presentacion: 30},
            {nombre: "Budesonida / Formoterol 160/4.5 mcg", presentacion: 60},
            {nombre: "Budesonida / Formoterol 320/9 mcg", presentacion: 120}
        ],
        casosEspeciales: ["Palivizumab 50 mg", "Palivizumab 100 mg", "Inmunoglobulina G", "Otro Caso Especial"],
        psiquiatria: ["Clonazepam 2 mg", "Sertralina 50 mg", "Quetiapina 25 mg", "Quetiapina 100 mg", "Haloperidol 5 mg"],
        medicosAlbumina: [
            {rut: "11111111-1", nombre: "DR. MEDICO UNO"},
            {rut: "22222222-2", nombre: "DRA. MEDICA DOS"}
        ]
    };
    try {
        await setDoc(doc(window.db, "configuracion", "maestros"), datosReales);
        console.log("¡Datos maestros subidos con éxito a Firestore!");
        alert("Base de datos maestra configurada con éxito.");
    } catch(e) {
        console.error("Error al subir:", e);
    }
};

// 7. OBTENER DATOS MAESTROS DE FIREBASE
window.obtenerDatosMaestrosFirebase = async function() {
    try {
        const docRef = doc(window.db, "configuracion", "maestros");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            let datos = docSnap.data();
            
            // Si viene la lista de médicos protegida, la desciframos localmente
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

// 8. FUNCIÓN TEMPORAL DE CARGA (Borrar después de usar)
window.subirDatosMaestrosUnaVez = async function() {
    const listaMedicosCruda = [
        {nombre: 'ADRIANA RESTREPO', rut: '24288901-0'}, {nombre: 'AHMED M M ALMANASSRA', rut: '26432011-9'}, {nombre: 'AILEN INOSTROZA', rut: '19656375-K'},
        {nombre: 'ALAN AYMÉ', rut: '25109091-2'}, {nombre: 'ALAN LAZCANO', rut: '15431340-0'}, {nombre: 'ANAIS SILVA', rut: '26228055-1'},
        {nombre: 'ANTONIA NARANJO', rut: '20297381-7'}, {nombre: 'ASDRUBAL LINDO', rut: '25956246-5'}, {nombre: 'CARLEVYS SALAZAR', rut: '26619720-9'},
        {nombre: 'CARLOS JARABA DE LA HOZ', rut: '25356596-9'}, {nombre: 'CARMEN PEREZ', rut: '26210619-5'}, {nombre: 'CATALINA BUSTAMANTE', rut: '19700194-1'},
        {nombre: 'CELINA PEREZ DE MARCA', rut: '25824674-8'}, {nombre: 'CLAUDIO SEPULVEDA', rut: '18347767-6'}, {nombre: 'DIANA SOLARTE', rut: '25537812-0'},
        {nombre: 'DIOMER ALCOLEA', rut: '28793703-2'}, {nombre: 'EDUARDO ACEVEDO', rut: '15339524-1'}, {nombre: 'FERNANDO RIVAS', rut: '11648582-6'},
        {nombre: 'FRANCISCO MIRANDA', rut: '7406044-7'}, {nombre: 'GALO GENARO SILVA', rut: '14675275-6'}, {nombre: 'IGNACIO ARAVENA', rut: '15341011-9'},
        {nombre: 'JAIME GOMEZ', rut: '17728664-8'}, {nombre: 'JERSON MARTINEZ', rut: '28162768-6'}, {nombre: 'JESUS FARFÁN', rut: '25824993-3'},
        {nombre: 'JESUS MORQUERA', rut: '27073809-5'}, {nombre: 'JHOALYN ALMERA', rut: '26281422-K'}, {nombre: 'JORDANO RIQUELME', rut: '18424123-4'},
        {nombre: 'JORGE MOSCOSO', rut: '14658707-0'}, {nombre: 'JOSE REYES', rut: '17409452-7'}, {nombre: 'JUAN CARLOS PALMA', rut: '14670469-7'},
        {nombre: 'MARGARITA SEPULVEDA', rut: '20074115-3'}, {nombre: 'MARIA CALDERIN', rut: '24833178-K'}, {nombre: 'MARIA TRINIDAD TAPIA', rut: '20108126-2'},
        {nombre: 'MARIANA MARTINEZ', rut: '24644805-1'}, {nombre: 'MARIO NEIRA', rut: '16875644-5'}, {nombre: 'MATIAS OLIVARES', rut: '20169799-9'},
        {nombre: 'MERCEDES COLOMBO', rut: '14710123-6'}, {nombre: 'MICHAEL BECERRA', rut: '25615616-4'}, {nombre: 'MIGUEL OLIVARES', rut: '19444354-4'},
        {nombre: 'NICOLAS ARRAÑO', rut: '18953069-2'}, {nombre: 'NOELIA NIEVA', rut: '28813699-8'}, {nombre: 'OSCAR IBARRA', rut: '26331528-6'},
        {nombre: 'RODRIGO ESCARATE', rut: '18957513-0'}, {nombre: 'TOMAS ARAYA', rut: '18991904-2'}, {nombre: 'VANESSA PULIDO', rut: '23875818-1'},
        {nombre: 'VICTORIA VILLAREAL', rut: '20299407-5'}, {nombre: 'DIEGO PEREZ VERA', rut: '18127514-6'}, {nombre: 'GUIDO SALAZAR', rut: '21275249-5'},
        {nombre: 'ASDSASAFDFDAS', rut: '12345678-9'}, {nombre: 'ANA VIDAL ORELLANA', rut: '26881993-2'}, {nombre: 'ADRIANA TUTIVEN', rut: '24209650-9'},
        {nombre: 'JOSE VALDERRAMA', rut: '14737762-2'}, {nombre: 'EDITH BUENAVEREZ', rut: '27326194-K'}, {nombre: 'DIEGO RODRIGUEZ', rut: '19606056-1'},
        {nombre: 'OTROS', rut: '0000000-0'}, {nombre: 'FERNANDA CACERES', rut: '19184900-0'}, {nombre: 'RICHARD BURGOS GUERRERO', rut: '7987445-0'},
        {nombre: 'EDDY CASTRO CASTRO', rut: '25412329-3'}, {nombre: 'FERNANDA CONTRERAS PAZ', rut: '19893325-2'}, {nombre: 'FRANCISCA OLLIVET - BESSON PACHECO', rut: '19766157-7'},
        {nombre: 'HELBER TORRES TORRES', rut: '13461759-4'}, {nombre: 'EIVYS NARVAEZ', rut: '26588944-1'}, {nombre: 'VELEZ MARGARITA', rut: '13461759-4'},
        {nombre: 'RAFAEL FRANCO CORTES', rut: '25649181-8'}, {nombre: 'MARIA FARIAS RIVAS', rut: '18176781-2'}, {nombre: 'MARÍA JOSE FARIAS', rut: '18176781-2'},
        {nombre: 'ANGELA GARCIA MEDINA', rut: '23721318-1'}, {nombre: 'JAVIER OLAVE AYALA', rut: '20226009-8'}, {nombre: 'FRANCISCO GODOY GONZALEZ', rut: '16479973-5'},
        {nombre: 'GINO LUEIZA CASTRO', rut: '17781695-7'}, {nombre: 'SEBASTIAN URIBE VALENZUELA', rut: '19936992-K'}
    ];

    // 1. Ciframos la lista de médicos antes de subirla
    const listaMedicosCifrada = listaMedicosCruda.map(med => ({
        nombre: window.cifrarDato(med.nombre),
        rut: window.cifrarDato(med.rut)
    }));

    // 2. Preparamos el paquete completo con tus nuevas listas
    const datosReales = {
        servicios: ["Medicina", "UCI", "UTI", "URG Adulto", "URG Infantil", "Pabellón", "Cirugía", "Pediatría", "Neonatología", "Ginecología"],
        digitadores: [
            "VIRNA", "FRANCISCO BARRA", "SIDNEY", "PAULINA DIAZ", "OTRO", "DANITZA", "LEONARDO", "FRANCISCO REYES", 
            "FRANCISCA ARANCIBIA", "PAULINA CABRERA", "MONSERRAT", "FERNANDA SEPULVEDA", "TAMARA MALDONADO", 
            "BYRON", "TERESA", "EMILIA GARCES", "CLAUDIO VILLAGRA"
        ],
        inhaladores: [
            {nombre: "Salbutamol 100 mcg", presentacion: 200}, {nombre: "Bromuro Ipratropio 20 mcg", presentacion: 200},
            {nombre: "Budesonida 200 mcg", presentacion: 120}, {nombre: "Fluticasona 125 mcg", presentacion: 120},
            {nombre: "Salmeterol / Fluticasona 25/125 mcg", presentacion: 120}, {nombre: "Salmeterol / Fluticasona 25/250 mcg", presentacion: 120},
            {nombre: "Tiotropio / Olodaterol 2.5/2.5 mcg", presentacion: 30}, {nombre: "Budesonida / Formoterol 160/4.5 mcg", presentacion: 60},
            {nombre: "Budesonida / Formoterol 320/9 mcg", presentacion: 120}
        ],
        casosEspeciales: [
            "Vildagliptina 50 mg", "Linagliptina 5 mg", "Empagliflozina 10 mg", "Sacubitrilo/Valsartán 49/51 mg", 
            "Sacubitrilo/Valsartán 24/26 mg", "Pregabalina 75 mg", "Pregabalina 150 mg", "Dapagliflozina 10 mg", 
            "Insulina Aspartica 300 UI/3 mL", "Insulina Degludec 300 UI/3 mL", "Insulina Glargina 100 UI/3 mL", 
            "Insulina Glargina 300 UI/1.5 mL", "Insulina Glulicina 100 UI/3 mL", "Bicalutamida 50 mg", 
            "Xigduo XR 1000 mg/5 mg", "Xigduo XR 1000 mg/10 mg", "Hierro 100 mg/5 mL", "Memantina 10 mg", 
            "Donepezilo 10 mg", "Pancreatina 25.000 UI", "Dexmedetomidina 200 mcg/2 mL"
        ],
        psiquiatria: [
            "Bupropion 150 mg", "Aripiprazol 10 mg", "Carbonato de Litio 300 mg", "Citalopram 20 mg", "Ziprasidona 40 mg", 
            "Clozapina 100 mg", "Eszopiclona 3 mg", "Fluoxetina 20 mg", "Flupentixol 20 mg/mL", "Lamotrigina 50 mg", 
            "Lamotrigina 100 mg", "Mirtazapina 30 mg", "Olanzapina 10 mg", "Olanzapina 10 mg IM", "Zuclopentixol 50 mg/mL", 
            "Zuclopentixol Decaonato 200 mg/mL", "Paroxetina 20 mg", "Trihexifenidilo 2 mg", "Venlafaxina 75mg", 
            "Trazodona 100 mg", "Risperidona 1 mg", "Risperidona 3 mg", "Risperidona 1 mg/mL", "Risperidona 37.5 mg"
        ],
        medicosAlbumina: listaMedicosCifrada
    };

    try {
        await setDoc(doc(window.db, "configuracion", "maestros"), datosReales);
        console.log("¡Datos maestros subidos con éxito a Firestore!");
        alert("Nuevas listas y digitadores configurados con éxito.");
    } catch(e) {
        console.error("Error al subir:", e);
    }
};