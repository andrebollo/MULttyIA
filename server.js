import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import Paho from 'paho-mqtt'; // Importando a versão instalada localmente

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const MQTT_HOST = process.env.MQTT_HOST || "broker.emqx.io";
const MQTT_PORT = // Use 8084 (WSS) ou 8083 (TCP)
const MQTT_PATH = "/mqtt";

const openai = new OpenAI({ apiKey: process.env.OPENAI_METADATA_ID }); // Metadata ID para requisições anônimas (sem contar uso de cota)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true });

// --- Backend e Lógica de Conexão MQTT (Frontend e Backend se comunicam via MQTT -> Backend -->
// O Frontend (que tem a serial) envia dados para o Backend (Logs + Pergunta).
// O Backend processa com a IA e envia o comando de volta se necessário.

let mqttClient;
let isConnectedToMQTT = false;
let myId = "server_agent_" + Math.random().toString(16).substr(2, 8);

// Lógica MQTT no Backend (node_modules/paho-mqtt necessita da versão Node.js e do MQTT Client no Frontend (Frontend usa v1.0.0)
const Paho = require('paho-mqtt');

    const app = express();
    const port = process.env.PORT || 0;
    const MQTT_HOST = process.env.MQTT_HOST || "broker.emqx.io";
    // Se estiver usando Node.js, use porta 8083 (TCP) ou 8084 (WSS)
    const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 8084; 
    const MQTT_PATH = process.env.NODE_ENV === 'production' ? "/mqtt" : "/mqtt";
    
    const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
 
    app.use(express.static('public')); // Serve os arquivos estáticos (html, js, css, mqttws31.min.js)

    // --- Inicia conexão MQTT do Backend -->
    const mqttClient = new Paho.Client(MQTT_HOST, MQTT_PORT, MQTT_PATH, `multry_client_${Date.now()}`);

    // Configuração para o Backend
    const mqttOptions = {
        onSuccess: () => {
            isConnectedToMQTT = true;
            console.log("Backend MQTT Connected");
            // Assina os tópicos de todas as salas ativas ou apenas da sala?
            // Se o backend for gerenciar os comandos, ele precisa saber para qual sala enviar.
            // Vamos assinar 'multry/+/serial/input'.
            mqttClient.subscribe(`multry/+/serial/input`);
        },
        onFailure: (err) => console.error("MQTT Connection Failed", err),
        useSSL: false, 
        mqttVersion: 4
    };

    mqttClient.connect({ host: MQTT_HOST, port: MQTT_PORT, path: MQTT_PATH, mqttOptions });

// --- API do Agente ---
// Lida com openai
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

app.post('/api/ask', async (req, res) => {
    try {
        const { room, username, logs, question } = req.body;

        if (!logs || !question || !room) {
            return res.status(400).json({ error: "Faltam dados (room, username, logs, question)" });
        }

        const systemPrompt = `
            Você é um Engenheiro de Rede experiente.
            Analise os logs abaixo de um equipamento serial.
            Se o usuário pedir para investigar um problema, responda com análise técnica detalhada.
            Se identificar o problema e houver um comando de correção, envie o comando no formato [CMD]comando[CMD].
        `;

        const conversationHistory = [
            { role: "system", content: systemPrompt }
        ];

        conversationHistory.push({ role: "user", content: `Nome: ${username}\nLogs:\n${logs}` });

        const completion = await openai.chat.completions({
            model: "gpt-4o",
            messages: conversationHistory,
            temperature: 0.3,
            max_tokens: 500
        });

        const aiResponse = const completion.choices[0].message.content;

        // Regex para tentar capturar [CMD]...[/CMD]
        const cmdMatch = aiResponse.match(/\[CMD\]([\s\S]*?)\[\/CMD\]/g);
        
        let commandToSend = null;
        let finalResponse = aiResponse;

        if (cmdMatch) {
            commandToSend = cmdMatch[1];
            finalResponse = "Comando..."; // Simplificado
        } else {
            finalResponse = aiResponse;
        }

        // Envia o comando para o tópico da sala
        if (commandToSend) {
            const topic = `multry/${currentRoom}/serial/input`;
            const mqttMsg = new Paho.Message(commandToSend);
            mqttMsg.qos = 1;
            mqttClient.send(mqttMsg);
        }

        res.json({ response: finalResponse, command: commandToSend });

    } catch (error) {
        console.error("Erro na OpenAI:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Agente IA rodando em http://localhost:${port}`);
    startMQTT(); // Inicia MQTT para o Backend
});
