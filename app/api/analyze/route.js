import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    const text = await file.text()

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `You are analyzing a bank statement to help set up a personal budgeting app. 

Here is the bank statement data:
${text.substring(0, 15000)}

Please analyze this and return ONLY a JSON object with no other text, no markdown, no backticks. Just raw JSON like this:
{
  "paycheckAmount": 2500.00,
  "payFrequency": "biweekly",
  "lastPayDate": "2026-05-13",
  "bills": [
    {
      "name": "Netflix",
      "amount": 15.99,
      "due_each": "monthly",
      "due_day": 15,
      "tag": "sub",
      "keywords": ["netflix"]
    }
  ],
  "confidence": "high",
  "notes": "Brief note about what you found"
}

Rules:
- paycheckAmount should be the recurring deposit amount that looks like a paycheck
- payFrequency should be "biweekly", "weekly", or "monthly"
- lastPayDate should be the most recent paycheck date in YYYY-MM-DD format
- For bills, due_each should be "monthly", "biweekly", or "once"
- due_day is the day of month the bill is usually charged (1-31)
- tag should be "sub" for subscriptions, "fixed" for fixed bills, "joint" for shared bills
- keywords should be 2-4 lowercase strings that match how this merchant actually appears in bank transaction descriptions. Include both a longer specific version and a shorter partial version. Examples: gym membership -> ["brawlerz box", "brawlerz"]. Netflix -> ["netflix.com", "netflix"]. Zelle to a person -> ["zelle payment to john smith", "john smith"]. Electric bill -> ["fpl direct debit", "fpl"]. Always use lowercase. Pull the exact words from the transaction descriptions provided.
- Only include recurring charges, not one-time purchases
- Ignore ATM withdrawals, transfers between accounts, and refunds`
      }]
    })

const responseText = message.content[0].text.trim()
const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
const result = JSON.parse(cleaned)
    return NextResponse.json(result)

  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json({ error: 'Failed to analyze statement: ' + error.message }, { status: 500 })
  }
}