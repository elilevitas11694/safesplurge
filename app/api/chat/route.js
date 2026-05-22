import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(request) {
  try {
    const { messages, context } = await request.json()

    const systemPrompt = `You are a personal financial assistant for SafeSplurge, a bi-weekly budgeting app. You know this user's complete financial picture.

PAYCHECK: ${context.paycheckAmount} (${context.payFrequency})
CURRENT BALANCE: ${context.balance || 'not entered'}

BILLS:
${context.bills?.map(b => `- ${b.name}: $${b.amount} (${b.due_each}${b.due_day ? ', due day '+b.due_day : ''})`).join('\n') || 'No bills set up'}

Be concise and specific to their actual numbers. No generic financial advice. Keep responses short and practical.`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: systemPrompt,
      messages: messages.map(m => ({role: m.role, content: m.content}))
    })

    return NextResponse.json({ reply: response.content[0].text })
  } catch (error) {
    console.error('Chat error:', error)
    return NextResponse.json({ reply: 'Sorry, something went wrong.' }, { status: 500 })
  }
}