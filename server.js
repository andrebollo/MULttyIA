import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { Paho } from 'paho-mqtt';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const MQTT_HOST = process.env.MQTT_HOST || 'broker.emqx.io';
const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 8083;
const MQTT_PATH = process.env.MQTT_PATH || '/mqtt';

// Configuração OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- MQTT Connection para o Backend (O Backend participa da sala para enviar comandos) ---
let mqttClient;
let isConnectedToMQTT = false;
const myId = "server_agent_" + Math.random().toString(16).substr(2, 8);

// Tópicos
const getTopic = (room) => `multry/${room}/serial/input`;

// Conecta o backend ao MQTT
function initMQTT() {
    const clientId = `multry_server_${Date.now()}`;
    mqttClient = new Paho.Client(MQTT_HOST, MQTT_PORT, MQTT_PATH, clientId);

    mqttClient.onConnectionLost = (responseObject) => {
        console.log("MQTT Connection Lost:", responseObject.errorMessage);
        setTimeout(initMQTT, 5000);
    };

    mqttClient.onMessageArrived = (message) => {
        const topic = message.destinationName;
        // O Backend ignora mensagens de chat e presença, foca em receber comandos para a serial
        if (topic.includes("/serial/output") || topic.includes("/serial/input")) {
            // O Backend pode receber comandos vindos de outros agentes ou de debug
            console.log("Backend recebeu dados serial:", topic);
        }
    };

    const options = {
        onSuccess: () => { isConnectedToMQTT = true; console.log("Backend MQTT Connected"); },
        onFailure: (e) => console.error("MQTT Connection Failed", e),
        useSSL: false, // Backend não precisa de WSS (local ou mesma rede)
        mqttVersion: 4
    };

    mqttClient.connect(options);
}

initMQTT();

// --- API do Agente ---

// Endpoint para o Frontend enviar dados e perguntas
app.post('/api/ask', async (req, res) => {
    try {
        const { room, username, logs, question } = req.body;

        if (!logs || !question || !room) {
            return res.status(400).json({ error: "Faltam dados (room, username, logs, question)" });
        }

        // 1. Constrói o Prompt para a IA
        const systemPrompt = `
            Você é um Engenheiro de Rede experiente.
            Analise os logs abaixo de um equipamento conectado serialmente.
            Se o usuário pedir para investigar um problema (ex: "O IP não pinga"), responda com análise técnica detalhada.
        
        Se você identificar o problema e houver um comando de correção (ex: "sh int gig0/0"), você DEVE enviar esse comando no formato:
        [CMD]comando[CMD]

        Exemplos de comandos que pode sugerir:
        - show ip interface
        - sh int gig0/0
        - show running-config
        
        Lógica: Se a resposta contiver um comando no formato [CMD]...[CMD], o sistema extrairá e o enviará para o usuário conectado na serial.
        Se não houver comando, apenas responda ao usuário com a análise.
        `;

        // Histórico de contexto (opcional, melhor para debugging complexo)
        const conversationHistory = [
            { role: "system", content: systemPrompt }
        ];

        // Adiciona a mensagem do usuário com os logs
        conversationHistory.push({ role: "user", content: `Nome: ${username}\nLogs do Sistema:\n${logs}` });

        // 2. Envia para a OpenAI
        const completion = await openai.chat.completions({
            model: "gpt-4o", // Modelo otimizado para análises técnicas
            messages: conversationHistory,
            temperature: 0.3, // Mais baixa temp para ser mais analítico
            max_tokens: 500 // Suficiente para análise e comando
        });

        const aiResponse = completion.choices[0].message.content;

        // 3. Processa a resposta da IA
        // Tenta encontrar um comando no formato [CMD]...[/CMD]
        // CORREÇÃO DA SINTAXE REGEX: 
        // Simplifiquei o regex para evitar erros de parse e tornar mais robusto
        // Busca por [CMD] ... [CMD] 
        const cmdMatch = aiResponse.match(/\[CMD\]([\s\S]*?)\[\/CMD\]/g); // Procura globalmente por [CMD]...[/CMD]

        let commandToSend = null;
        let finalResponse = aiResponse;

        if (cmdMatch) {
            commandToSend = cmdMatch[1]; // Captura o conteúdo dentro dos colchetes
            finalResponse = "Comando detectado. Enviando para a serial...";
        } else {
            finalResponse = aiResponse;
        }

        // 4. Envia o comando para a serial (via MQTT) para o usuário com a porta aberta
        if (commandToSend) {
            // O Backend envia o comando para o tópico /serial/input da sala
            // O usuário conectado à serial receberá isso e executará o comando no hardware
            const mqttMsg = new Paho.Message(commandToSend);
            mqttMsg.destinationName = `${room}/serial/input`;
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
    // Inicia conexão MQTT
    initMQTT();
});
