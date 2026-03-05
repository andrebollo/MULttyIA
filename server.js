import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
const MQTT_HOST = process.env.MQTT || "broker.emqx.io"; // Suficiente para a conexão local
const MQTT_PORT = parseInt(process.env.MQTT_PORT || 8083); // Porta WSS padrão para emqx.io
const MQTT_PATH = process.env.MQTT || "/mqtt"; // Path padrão para emqx.io
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY }); // Ainda usado no server.js se você quiser capturar logs da IA

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Variáveis Globais
let mqttClient;
let isConnectedToMQTT = false;
const myId = "server_agent_" + Math.random().toString(16).substr(2, 8);
let currentSubscribedRooms = new Set(); // Apenas para otimizar salas ativas se necessário

// --- Lógica MQTT ---
function startMQTT() {
    // Use string vazia ou valor padrão para host e path
    // Emqx.io suporta "broker.emqx.io" em WSS (Porta 8084) e "/mqtt" é o padrão.
    const host = process.env.MQTT || "broker.emqx.io";
    const port = parseInt(process.env.MQTT_PORT || 8084);
    const path = process.env.MQTT || "/mqtt";
    
    const clientId = multry_server_$Date.now();
    mqttClient = new Paho.Client(host, port, path, clientId);

    mqttClient.onConnectionLost = (responseObject);
        console.log("MQTT Connection Lost:", responseObject.errorMessage);
        setTimeout(startMQTT, 5000);
    };

    const options = {
        onSuccess: () => {
            isConnectedToMQTT = true;
            console.log("Backend MQTT Connected");
            mqttClient.subscribe(`multry/+/serial/input`); // Assina o tópico de input serial (usado pelo Agente ou Usuário com a porta aberta)
        },
        onFailure: (err) => console.error("MQTT Connection Failed", err),
        keepAliveInterval: 30,
        timeout: 10,
        mqttVersion: 4,
        useSSL: true
    };

    mqttClient.connect({ host, port, path, clientId, options });

// Inicializa o MQTT assim que o servidor inicie antes das outras chamadas
startMQTT();

// --- API do Agente ---

app.post('/api/ask', async (req, res)) {
    try {
        const { room, username, logs, question } = req.body;

        if (!logs || !question || !room) {
            return res.status(400).json({ error: "Faltam dados (room, username, logs, question)" });
        }

        const systemPrompt = `
            Você é um Engenheiro de Rede experiente.
            Analise os logs abaixo de um equipamento conectado serialmente.
            Se o usuário pedir para investigar um problema (ex: "O IP não pinga"), responda com análise técnica detalhada.
            Se você identificar o problema e houver um comando de correção, envie o comando no formato: [CMD]comando[CMD].
        `;

        const conversationHistory = [
            { role: "system", content: systemPrompt }
        ];

        conversationHistory.push({ role: "user", content: `Nome: ${username}\nLogs do Sistema:\n${logs}` });

        const completion = await openai.chat.completions({
            model: "gpt-4o", 
            messages: 
 conversationHistory,
            temperature: 0.3,
            max_tokens: 500 
        });

        const aiResponse = completion.choices[0].message.content;
        
        const cmdMatch = aiResponse.match(/\[CMD\]([\s\S]*?)\[\/CMD\]/g); 
        
        let commandToSend = null;
        let finalResponse = aiResponse;

        if (cmdMatch) {
            commandToSend = cmdMatch[1];
            finalResponse = "Comando detectado. Enviando para a serial...";
        } else {
            finalResponse = aiResponse;
        }

        if (commandToSend) {
            const topic = `${room}/serial/input`;
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
    startMQTT();
});
