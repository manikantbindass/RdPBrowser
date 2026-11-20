'use strict';
jest.mock('axios',() => ({ get:jest.fn() }));
const axios=require('axios');
const express=require('express');
const request=require('supertest');
const { requestContext,errorHandler }=require('../http/errors');
const app=express(); app.use(requestContext); app.use('/search',require('../routes/laila')); app.use(errorHandler({ error() {} }));
beforeEach(() => axios.get.mockReset());
test('public search bounds inputs before outbound work',async () => {
  expect((await request(app).get('/search/search?q='+ 'x'.repeat(501))).status).toBe(400);
  expect((await request(app).get('/search/search?q[a]=b')).status).toBe(400);
  expect(axios.get).not.toHaveBeenCalled();
});
test('upstream outage is explicit and never echoes raw transport credentials',async () => {
  axios.get.mockRejectedValue(new Error('private token'));
  const result=await request(app).get('/search/search?q=test');
  expect(result.status).toBe(503); expect(result.body.code).toBe('UPSTREAM_UNAVAILABLE');
  expect(JSON.stringify(result.body)).not.toContain('private');
  expect(axios.get.mock.calls[0][1]).toEqual({ timeout:5000,maxContentLength:1024*1024,maxRedirects:0 });
});
