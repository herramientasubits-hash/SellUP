import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchFedesoftDirectoryListings,
  fetchFedesoftCategories,
  fetchFedesoftLocations,
  parseFedesoftMembersTable,
} from '../fedesoft-client';

afterEach(() => {
  mock.restoreAll();
});

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchFedesoftDirectoryListings', () => {
  it('fetches page 1 and page 2, stops when page 2 has < perPage items', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      slug: `company-${i + 1}`,
      title: `Company ${i + 1}`,
      date: '2024-01-01',
      modified: '2024-01-01',
      type: 'at_biz_dir',
      link: `https://fedesoft.org/company/${i + 1}`,
      at_biz_dir_category: [],
      at_biz_dir_location: [],
    }));
    const page2 = Array.from({ length: 37 }, (_, i) => ({
      id: 101 + i,
      slug: `company-${101 + i}`,
      title: `Company ${101 + i}`,
      date: '2024-01-01',
      modified: '2024-01-01',
      type: 'at_biz_dir',
      link: `https://fedesoft.org/company/${101 + i}`,
      at_biz_dir_category: [],
      at_biz_dir_location: [],
    }));

    let callCount = 0;
    mock.method(globalThis, 'fetch', async (url: string) => {
      callCount++;
      if (url.includes('page=1&')) return makeJsonResponse(page1);
      if (url.includes('page=2&')) return makeJsonResponse(page2);
      return makeJsonResponse([]);
    });

    const result = await fetchFedesoftDirectoryListings({ perPage: 100 });

    assert.equal(result.length, 137);
    assert.equal(result[0].id, 1);
    assert.equal(result[136].id, 137);
    assert.equal(callCount, 2);
  });

  it('stops when empty page is returned', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      slug: `company-${i + 1}`,
      title: `Company ${i + 1}`,
      date: '2024-01-01',
      modified: '2024-01-01',
      type: 'at_biz_dir',
      link: `https://fedesoft.org/company/${i + 1}`,
      at_biz_dir_category: [],
      at_biz_dir_location: [],
    }));

    let callCount = 0;
    mock.method(globalThis, 'fetch', async (url: string) => {
      callCount++;
      if (url.includes('page=1&')) return makeJsonResponse(page1);
      return makeJsonResponse([]);
    });

    const result = await fetchFedesoftDirectoryListings({ perPage: 100 });

    assert.equal(result.length, 100);
    assert.equal(callCount, 2);
  });

  it('respects maxPages option', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      slug: `company-${i + 1}`,
      title: `Company ${i + 1}`,
      date: '2024-01-01',
      modified: '2024-01-01',
      type: 'at_biz_dir',
      link: `https://fedesoft.org/company/${i + 1}`,
      at_biz_dir_category: [],
      at_biz_dir_location: [],
    }));

    let callCount = 0;
    mock.method(globalThis, 'fetch', async () => {
      callCount++;
      return makeJsonResponse(page1);
    });

    const result = await fetchFedesoftDirectoryListings({ perPage: 100, maxPages: 1 });

    assert.equal(result.length, 100);
    assert.equal(callCount, 1);
  });

  it('handles empty response on first page', async () => {
    mock.method(globalThis, 'fetch', async () => makeJsonResponse([]));

    const result = await fetchFedesoftDirectoryListings();

    assert.equal(result.length, 0);
  });

  it('throws on non-ok response', async () => {
    mock.method(globalThis, 'fetch', async () => makeJsonResponse({ message: 'Not Found' }, 404));

    await assert.rejects(
      () => fetchFedesoftDirectoryListings(),
      { message: /HTTP 404/ },
    );
  });
});

describe('fetchFedesoftCategories', () => {
  it('returns map of id to name', async () => {
    const categories = [
      { id: 1, name: 'Software', slug: 'software' },
      { id: 2, name: 'Consultoría', slug: 'consultoria' },
    ];
    mock.method(globalThis, 'fetch', async () => makeJsonResponse(categories));

    const result = await fetchFedesoftCategories();

    assert.equal(result.size, 2);
    assert.equal(result.get(1), 'Software');
    assert.equal(result.get(2), 'Consultoría');
  });

  it('returns empty map when no categories', async () => {
    mock.method(globalThis, 'fetch', async () => makeJsonResponse([]));

    const result = await fetchFedesoftCategories();

    assert.equal(result.size, 0);
  });
});

describe('fetchFedesoftLocations', () => {
  it('returns map of id to location name', async () => {
    const locations = [
      { id: 10, name: 'Bogotá', slug: 'bogota' },
      { id: 20, name: 'Medellín', slug: 'medellin' },
    ];
    mock.method(globalThis, 'fetch', async () => makeJsonResponse(locations));

    const result = await fetchFedesoftLocations();

    assert.equal(result.size, 2);
    assert.equal(result.get(10), 'Bogotá');
    assert.equal(result.get(20), 'Medellín');
  });
});

describe('parseFedesoftMembersTable', () => {
  const tableHtml = `
    <html>
    <body>
      <div id="tablepress-1-members_wrapper">
        <table class="tablepress tablepress-id-1">
          <thead>
            <tr>
              <th>Tipo Miembro</th>
              <th>NIT</th>
              <th>Empresa Afiliada</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Activo</td>
              <td>900.123.456-7</td>
              <td>Tech Solutions SAS</td>
            </tr>
            <tr>
              <td>Activo</td>
              <td>800.234.567</td>
              <td>Digital Systems Ltda</td>
            </tr>
            <tr>
              <td>Honorario</td>
              <td></td>
              <td>Independent Consultant</td>
            </tr>
          </tbody>
        </table>
      </div>
    </body>
    </html>
  `;

  it('extracts memberType, NIT and company name from 3 rows', () => {
    const members = parseFedesoftMembersTable(tableHtml);

    assert.equal(members.length, 3);

    assert.equal(members[0].memberType, 'Activo');
    assert.equal(members[0].taxId, '900.123.456-7');
    assert.equal(members[0].companyName, 'Tech Solutions SAS');

    assert.equal(members[1].memberType, 'Activo');
    assert.equal(members[1].taxId, '800.234.567');
    assert.equal(members[1].companyName, 'Digital Systems Ltda');

    assert.equal(members[2].memberType, 'Honorario');
    assert.equal(members[2].taxId, null);
    assert.equal(members[2].companyName, 'Independent Consultant');
  });

  it('throws when no tablepress table found', () => {
    const html = '<html><body>No table here</body></html>';

    assert.throws(
      () => parseFedesoftMembersTable(html),
      { message: /No se encontró tabla TablePress/ },
    );
  });

  it('throws when table has no member rows', () => {
    const emptyTableHtml = `
      <html>
      <body>
        <table class="tablepress">
          <thead>
            <tr><th>Tipo Miembro</th><th>NIT</th><th>Empresa Afiliada</th></tr>
          </thead>
          <tbody>
          </tbody>
        </table>
      </body>
      </html>
    `;

    assert.throws(
      () => parseFedesoftMembersTable(emptyTableHtml),
      { message: /No se pudieron extraer registros/ },
    );
  });

  it('discards rows with empty company name', () => {
    const htmlWithEmpty = `
      <html>
      <body>
        <table class="tablepress">
          <thead>
            <tr><th>Tipo Miembro</th><th>NIT</th><th>Empresa Afiliada</th></tr>
          </thead>
          <tbody>
            <tr><td>Activo</td><td>900.123.456</td><td>Valid Company</td></tr>
            <tr><td>Activo</td><td></td><td></td></tr>
          </tbody>
        </table>
      </body>
      </html>
    `;

    const members = parseFedesoftMembersTable(htmlWithEmpty);

    assert.equal(members.length, 1);
    assert.equal(members[0].companyName, 'Valid Company');
  });
});
