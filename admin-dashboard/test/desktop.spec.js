import { test,expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
let server,origin;
test.beforeAll(async()=>{
  const root=path.resolve('../desktop/dist');
  server=http.createServer((req,res)=>{
    const filename=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
    if (!filename.startsWith(root+path.sep) || !fs.existsSync(filename)) {res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html');
    res.end(fs.readFileSync(filename));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
});
test.afterAll(async()=>{await new Promise(resolve=>server.close(resolve));});
test('desktop login supports keyboard labels and rejects browser authentication without native IPC',async({page})=>{
  let requests=0;page.on('request',request=>{if(request.method()==='POST')requests++;});
  await page.goto(origin);await page.getByLabel('Username',{exact:true}).fill('fixture');
  await page.keyboard.press('Tab');await expect(page.getByLabel('Password',{exact:true})).toBeFocused();
  await page.keyboard.type('FixturePassword12!');await page.getByRole('button',{name:/sign in/i}).click();
  await expect(page.getByText('Open the native desktop application to sign in.')).toBeVisible();expect(requests).toBe(0);
});
test('desktop login has no automated accessibility violations',async({page})=>{
  await page.goto(origin);expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
});
test('desktop login fits a narrow viewport',async({page})=>{
  await page.setViewportSize({width:360,height:740});await page.goto(origin);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
