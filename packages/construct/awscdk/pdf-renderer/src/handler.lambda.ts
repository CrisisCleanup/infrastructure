import chrome from '@sparticuz/chromium'
import type { APIGatewayEvent } from 'aws-lambda'
import puppeteer, { type Browser } from 'puppeteer-core'
import { z } from 'zod'

const schema = z
	.object({
		content: z.string().describe('Raw HTML content to render'),
		width: z.string().optional().describe('Width of the PDF in px, in, or mm'),
		height: z
			.string()
			.optional()
			.describe('Height of the PDF in px, in, or mm'),
	})
	.partial({ width: true, height: true })

const doRender = async (
	browser: Browser,
	props: z.infer<typeof schema>,
): Promise<Buffer> => {
	const { content, height, width } = props
	const page = await browser.newPage()
	await page.setContent(content, {
		waitUntil: 'networkidle0',
	})

	const pdf = await page.pdf({
		printBackground: true,
		width: width,
		height: height,
		pageRanges: '1',
	})
	return pdf
}

export async function handler(event: APIGatewayEvent) {
	console.log('Incoming event:', event)

	const payload = await schema.parseAsync(JSON.parse(event.body!))
	console.log('Received payload:', payload)
	// eslint-disable-next-line @typescript-eslint/await-thenable,@typescript-eslint/unbound-method
	const path = await chrome.executablePath
	console.log('Path is:', path)

	const browser = await puppeteer.launch({
		// @ts-expect-error is actually a string
		executablePath: path,
		headless: chrome.headless,
		args: chrome.args,
	})

	try {
		const pdf = await doRender(browser, payload)
		return {
			statusCode: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': 'attachment; filename="result.pdf"',
				'Content-Encoding': 'base64',
			},
			body: pdf.toString('base64'),
			isBase64Encoded: true,
		}
	} catch (e: unknown) {
		console.error('Error rendering PDF:', e)
		return {
			statusCode: 500,
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				error: e instanceof Error ? e.message : String(e),
			}),
		}
	} finally {
		console.log('Closing browser')
		await browser.close()
	}
}
