require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// --- SISTEMA DE PROMPT (ENGINEERING) ---
const SYSTEM_PROMPT = `
Você é uma IA especialista em redes de computadores e telecomunicações, agindo como um analista de suporte Nível 3. 
Você está ajudando um usuário a configurar e testar equipamentos de rede através de um terminal serial compartilhado.

SUAS TAREFAS:
1. Receba logs de configuração e comandos do usuário.
2. Analise o log. Se o usuário não conseguir pingar o IP, sugira testes de conectividade (ping, traceroute, arp, show ip interface, show running-config).
3. Se o usuário colar um script ou erro, analise e sugira correções.
4. Quando você precisar enviar um comando para o terminal serial, use o seguinte formato estrito:
   [CMD]seu_comando_aqui[/CMD]

5. Se for apenas conversar, responda normalmente.

Seja preciso, direto e profissional.
`;

// Buffer de memória para dar contexto à IA (últimas mensagens)
const aiMemory = []; // Armazena role e conteúdo

// --- ROTAS ---

// Rota para iniciar chat com IA
app.post('/api/ai/send', async (req, res) => {
    const { message, history } = req.body;

    // Adiciona nova mensagem ao histórico
    const newMessage = { role: 'user', content: message };
    const messages = [...history, newMessage];

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4", // Use gpt-3.5-turbo ou gpt-4
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...messages
            ],
            temperature: 0.7,
        });

        // Tenta extrair comando entre tags [CMD] ... [/CMD]
        const aiResponseText = completion.choices[0].message.content;

        // Regex para extrair comandos
        const cmdMatch = aiResponseText.match(/\[CMD\](.*?)\[\/CMD\]/s*([\s\S]*?)\s*(?:\[\/CMD\])?/);
        
        const finalResponse = cmdMatch ? cmdMatch[1] : aiResponseText;

        res.json({ response: finalResponse });

    } catch (error) {
        console.error("Erro OpenAI:", error);
        res.status(500).json({ error: "Erro ao comunicar com a IA." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
});
