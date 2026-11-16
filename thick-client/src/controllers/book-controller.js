export function bookController(service) {
  return {
    list: async (req, res) => {
      const data = await service.list(req.query);
      res.json({ data, meta: { count: data.length } });
    },
    get: async (req, res) => res.json({ data: await service.get(req.params.id) }),
    create: async (req, res) => {
      const data = await service.create(req.body);
      res.status(201).location(`/api/books/${data.id}`).json({ data });
    },
    update: async (req, res) => res.json({ data: await service.update(req.params.id, req.body, req.method === 'PATCH') }),
    delete: async (req, res) => res.json({ data: await service.delete(req.params.id) }),
    borrow: async (req, res) => {
      const data = await service.borrow(req.params.id, req.body);
      res.status(201).location(`/api/books/${req.params.id}/loans/${data.id}`).json({ data });
    },
    loans: async (req, res) => res.json({ data: await service.loans(req.params.id) }),
    loan: async (req, res) => res.json({ data: await service.loan(req.params.id, req.params.loanId) }),
    returnLoan: async (req, res) => res.json({ data: await service.returnLoan(req.params.id, req.params.loanId) }),
    allLoans: async (req, res) => res.json({ data: await service.allLoans(req.query) }),
    statistics: async (req, res) => res.json({ data: await service.statistics() }),
  };
}
