import { convertToParamMap, ActivatedRoute, Router } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlertService } from '../../core/alert.service';
import { ConnectionService } from '../../core/connection.service';
import { ConnectApiService } from './connect-api.service';
import { ConnectComponent } from './connect.component';

describe('ConnectComponent', () => {
  let fixture: ComponentFixture<ConnectComponent>;
  let component: ConnectComponent;
  const connect = vi.fn();
  const navigate = vi.fn().mockResolvedValue(true);
  const alertError = vi.fn();
  const getHosts = vi.fn().mockResolvedValue(['production', 'local']);
  const testConnection = vi.fn();

  beforeEach(async () => {
    connect.mockClear();
    navigate.mockClear();
    alertError.mockClear();
    getHosts.mockClear();
    testConnection.mockReset();

    await TestBed.configureTestingModule({
      imports: [ConnectComponent],
      providers: [
        {
          provide: ConnectApiService,
          useValue: { getHosts, testConnection },
        },
        {
          provide: ConnectionService,
          useValue: { host: () => undefined, connect },
        },
        { provide: AlertService, useValue: { error: alertError } },
        { provide: Router, useValue: { navigate } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConnectComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('loads and sorts known hosts', () => {
    expect(component.hosts()).toEqual(['local', 'production']);
  });

  it('stores a successful connection and navigates to overview', async () => {
    testConnection.mockResolvedValue({ status: 200, body: {} });

    await component.connectTo('http://localhost:9200');

    expect(connect).toHaveBeenCalledWith('http://localhost:9200');
    expect(navigate).toHaveBeenCalledWith(['/overview'], {
      queryParams: { host: 'http://localhost:9200' },
    });
  });

  it('switches to credentials while preserving the host on ES 401', async () => {
    testConnection.mockResolvedValue({ status: 401, body: {} });

    await component.connectTo('http://secure:9200');

    expect(component.unauthorized()).toBe(true);
    expect(navigate).toHaveBeenCalledWith([], {
      queryParams: {
        host: 'http://secure:9200',
        unauthorized: true,
      },
      replaceUrl: true,
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('keeps the legacy invalid-credentials feedback', async () => {
    testConnection.mockResolvedValue({ status: 401, body: {} });
    component.host = 'http://secure:9200';
    component.username = 'elastic';
    component.password = 'wrong';

    await component.authorize();

    expect(component.feedback()).toBe('Invalid username or password');
  });
});
