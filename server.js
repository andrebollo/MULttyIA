// Configurações MQTT
const MQTT_HOST = "broker.emqx.io";
const MQTT_PORT = 8084; // Porta WSS para EMQX
const MQTT_PATH = "/mqtt";

// --- CONFIGURAÇÃO DO SERVER (Node.js) ---
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import Paho from 'paho-mqtt'; // Importação corrigida (usa biblioteca instalada)
import * as fs from 'fs';
import path from 'path';
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const MQTT_HOST = process.env.MQTT_HOST || "broker.emqx.io";
const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 8084; // Usa 8084 (WSS)
const MQTT_PATH = process.env.MQTT_PATH || "/mqtt";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let mqttClient;
let isConnectedToMQTT = false;
const myId = "server_agent_" + Math.random().toString(16).substr(2, 8);
let currentSubscribedRooms = new Set(); // Acompanhará salas ativas (estatísticas simples)

function startMQTT() {
    const clientId = `multry_server_${Date.now()}`;
    // Usa o import 'paho-mqtt' (versão 2.0.0)
    mqttClient = new Paho.Client(MQTT_HOST, MQTT_PORT, MQTT_PATH, clientId);

    mqttClient.onConnectionLost = (responseObject) => {
        console.log("MQTT Connection Lost:", responseObject.errorMessage);
        setTimeout(startMQTT, 5000);
    };

    const options = {
        onSuccess: () => {
            isConnectedToMQTT = true;
            console.log("Backend MQTT Connected");
            mqttClient.subscribe(`multry/+/serial/input`);
        },
        onFailure: (err) => console.error("MQTT Connection Failed", err),
        keepAliveInterval: 30,
        timeout: 10,
        mqttVersion: 4,
        useSSL: true
    };

    mqttClient.connect({ host: MQTT_HOST, port: MQTT_PORT, path: MQTT_PATH, options });
}

startMQTT();

// --- API do Agente ---
app.post('/api/add-user-log', async (req, res) {
    // Endpoint que o frontend chama periodicamente para enviar os logs
    try {
        const { room, log } = req.body;
        if (!room || !log) return res.status(400).json({ error: "Faltam dados" });
        
        // Envia os logs para o Backend via MQTT (O Backend é o que tem a chave OpenAI)
        const topic = `${room}/logs`; // Tópico especial para logs
        const mqttMsg = new Paho.Message(log);
        mqttMsg.destinationName = topic;
        mqttMsg.qos = 1;
        mqttClient.send(mqttMsg);
        
        res.json({ status: "success" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/ask', async (req, res) {
    try {
        const { room, username, question } = req.body;
        
        // Busca os últimos logs no Backend através do endpoint '/add-user-log'
        // (O Backend deve salvar os logs em memória temporária)
        if (!room) return res.status(400).json({ error: "Sala não informada." });
        
        // Simulação de busca de memória (substitua `fs.readFileSync` por um array em memória se for local)
        // Para simplificar, vamos apenas acumular em uma string para sessão em memória
        if (!globalLogs[room]) globalLogs[room] = "";
        
        globalLogs[room] += `${new Date().toLocaleTimeString()} - ${room}: ${currentUser}: ${question}\n`;
        
        const finalLogs = globalLogs[room]; // Usa os logs acumulados
        const lastLogs = finalLogs.split('\n').slice(-30).join('\n'); // Últimos logs para a IA
        
        const systemPrompt = `
            Você é um Engenheiro de Rede experiente.
            Analise os logs abaixo (capturados pelo Backend) para sugerir correções.
            Se identificar um problema, envie o comando no formato [CMD]comando[CMD].
        `;
        
        const conversationHistory = [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Nome: ${username}\nLogs:\n${lastLogs}` }
        ];

        const completion = await openai.chat.completions({
            model: "gpt-4o", 
            messages: conversationHistory,
            temperature: 0.3,
            max_tokens: 500
        });

        const aiResponse = completion.choices[0].message.content;
        
        // Regex para extrair comandos
        // Aceita [CMD]...[/CMD] (com colchetes literais "[]")
        const cmdMatch = aiResponse.match(/\[CMD\]([\s\S]*?)\[\/CMD\]/g); 
        
        let commandToSend = null;
        let finalResponse = aiResponse;
        
        if (cmdMatch) {
            commandToSend = cmdMatch[1];
            finalResponse = "Comando detectado. Enviando para a serial...";
        } else {
            finalResponse = aiResponse;
        }

        // Se houver comando, envia para a serial via MQTT
        if (commandToSend) {
            // Envia para sala/serial/input
            const topic = `${room}/serial/input`;
            const mqttMsg = new Paho.Message(commandToSend);
            mqttMsg.qos = 1;
            mqttClient.send(mqttMsg);
        }

        res.json({ response: finalResponse, command: // Removei o `command` do JSON de retorno para não ficar exposta
            response: finalResponse
        });

app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
    startMQTT();
});
