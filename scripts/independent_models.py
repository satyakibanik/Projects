"""All 19 independent challenge models and eight chronological ensembles.

Ported from the user's local Forecast_sb challenge; no PGCB scenario/correction
models or target-day observed demand/generation enter these implementations.
"""
import time
import warnings
import numpy as np
from catboost import CatBoostRegressor
from scipy.optimize import linprog
from sklearn.compose import TransformedTargetRegressor
from sklearn.decomposition import PCA
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import HuberRegressor, Ridge
from sklearn.neighbors import KNeighborsRegressor
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import SplineTransformer, StandardScaler
from sklearn.svm import SVR
from forecast_features import features, shift

REGISTRY={}
def register(name,track,family,description):
    REGISTRY[name]=dict(track=track,family=family,description=description)

for name,description in [('Lag 2 days','Two-day persistence'),('Weekly naive','Same weekday last week'),
                         ('Weekday mean','Four matching weekdays')]:register(name,'Independent','Baseline',description)
for name,description in [('Ridge enriched','Ridge alpha 100, 100-day window'),('Ridge recent','Ridge alpha 100, 45-day window'),
                         ('Huber weather','Robust Huber regression, scaled target, 100-day window'),
                         ('Spline weather','Quadratic splines with 4 knots, ridge alpha 100, compact history/weather features')]:register(name,'Independent','Statistical',description)
for name,description in [('SVR weather','RBF support vector regression C=5, epsilon .08, standardized features and target'),
                         ('Nearest neighbors','30 nearest hourly feature vectors, distance weights')]:register(name,'Independent','Kernel / analog',description)
for name,description in [('Boosted weather RMSE','HistGradientBoosting, 180 iterations, 12 leaves, L2 20'),
                         ('Boosted weather MAE','HistGradientBoosting absolute error, 160 iterations, 10 leaves, L2 20'),
                         ('CatBoost MAE','350 iterations, depth 4, learning rate .05, L2 10, MAE loss'),
                         ('CatBoost RMSE','400 iterations, depth 6, learning rate .04, L2 20, RMSE loss'),
                         ('CatBoost recent','MAE model with 45-day training window'),
                         ('Extra Trees weather','150 extremely randomized trees, depth 14, minimum leaf 6')]:register(name,'Independent','Tree ensembles',description)
register('MLP weather','Independent','Neural networks','Tanh MLP 32/16, alpha 1, Adam, maximum 2000 epochs, compact features, no random validation split')
register('Daily PCA ridge','Independent','Daily profile','Five principal components of the demeaned daily shape plus daily mean, ridge alpha 100')
register('Daily MLP','Independent','Neural networks','Daily 24-output MLP 32/16, LBFGS, alpha 5, maximum 800 iterations; training-only scaling')
register('Weather analog days','Independent','Kernel / analog','Five nearest daily profiles using scaled prior-generation and forecast-weather summaries')
INDEPENDENT_POOL=('Ridge enriched','Boosted weather MAE','CatBoost MAE','Extra Trees weather','SVR weather','MLP weather','Daily PCA ridge')

for name, description in [
    ('Independent mean ensemble', 'Equal mean of the fixed seven-model pool'),
    ('Independent median ensemble', 'Pointwise median of the fixed seven-model pool'),
    ('Independent inverse-error blend', 'Inverse squared MAE weights on earlier out-of-sample errors'),
    ('Independent convex stack', 'Nonnegative sum-to-one MAE weights on earlier out-of-sample errors'),
    ('Independent ridge stack', 'Ridge alpha 100 fitted on earlier out-of-sample predictions'),
    ('Independent full-pool convex', 'Convex MAE stack over all 19 base and five fixed-pool ensemble models'),
    ('Independent full-pool top3', 'Equal mean of the three lowest earlier out-of-sample MAE candidates'),
    ('Independent full-pool ridge', 'Ridge alpha 100 on all 24 earlier independent candidates')]:
    register(name, 'Independent', 'Ensembles', description)

BASE_MODELS = tuple(name for name, info in REGISTRY.items() if info['family'] != 'Ensembles')

def normalized(regressor):
    return TransformedTargetRegressor(regressor=make_pipeline(SimpleImputer(),StandardScaler(),regressor),transformer=StandardScaler())


def cat(loss,depth=4,iterations=350):
    return CatBoostRegressor(loss_function=loss,depth=depth,iterations=iterations,
        learning_rate=.05 if depth==4 else .04,l2_leaf_reg=10 if depth==4 else 20,
        random_seed=42,thread_count=2,verbose=False,allow_writing_files=False)


def fit_origin(data,origin,target):
    training=data.training_days(origin)
    if len(training)<35:raise ValueError('Insufficient chronological training')
    predictions={};diagnostics=[]
    x=np.concatenate([data.strict(d,target) for d in training]);test=data.strict(origin,target)
    compact=lambda d:np.c_[features(data.days,d,target),data.weather_day(d).reshape(24,4,5).mean(axis=1)]
    compact_x=np.concatenate([compact(d) for d in training]);compact_test=compact(origin)
    y=np.concatenate([data.days[d][target] for d in training])
    nonempty=np.isfinite(x).any(axis=0)
    short_count=min(45,len(training))*24
    def fit(name,model,fit_x,fit_y,predict_x,offset=0):
        started=time.monotonic()
        with warnings.catch_warnings(record=True) as found:
            warnings.simplefilter('always')
            output=model.fit(fit_x,fit_y).predict(predict_x)
        predictions[name]=np.maximum(0,np.asarray(output).ravel()+offset)
        diagnostics.append(dict(model=name,seconds=round(time.monotonic()-started,3),
            warnings=[str(w.message) for w in found]))
    lag=lambda n:data.days[shift(origin,n)][target]
    predictions.update({'Lag 2 days':lag(2),'Weekly naive':lag(7),
                        'Weekday mean':np.mean([lag(i) for i in (7,14,21,28)],axis=0)})
    fit('Ridge enriched',make_pipeline(SimpleImputer(),StandardScaler(),Ridge(alpha=100)),x,y,test)
    fit('Ridge recent',make_pipeline(SimpleImputer(),StandardScaler(),Ridge(alpha=100)),x[-short_count:],y[-short_count:],test)
    fit('Huber weather',normalized(HuberRegressor(epsilon=1.5,alpha=.1,max_iter=500)),compact_x,y,compact_test)
    fit('Spline weather',make_pipeline(SimpleImputer(),SplineTransformer(n_knots=4,degree=2,include_bias=False),StandardScaler(),Ridge(alpha=100)),compact_x,y,compact_test)
    fit('SVR weather',normalized(SVR(C=5,epsilon=.08)),compact_x,y,compact_test)
    fit('Nearest neighbors',normalized(KNeighborsRegressor(n_neighbors=30,weights='distance')),x,y,test)
    fit('Boosted weather RMSE',HistGradientBoostingRegressor(max_iter=180,max_leaf_nodes=12,min_samples_leaf=25,l2_regularization=20,early_stopping=False,random_state=42),x[:,nonempty],y,test[:,nonempty])
    fit('Boosted weather MAE',HistGradientBoostingRegressor(loss='absolute_error',max_iter=160,max_leaf_nodes=10,min_samples_leaf=30,l2_regularization=20,early_stopping=False,random_state=42),x[:,nonempty],y,test[:,nonempty])
    fit('CatBoost MAE',cat('MAE'),x,y,test)
    fit('CatBoost RMSE',cat('RMSE',6,400),x,y,test)
    fit('CatBoost recent',cat('MAE'),x[-short_count:],y[-short_count:],test)
    fit('Extra Trees weather',make_pipeline(SimpleImputer(),ExtraTreesRegressor(n_estimators=150,max_depth=14,min_samples_leaf=6,max_features=.8,n_jobs=2,random_state=42)),x,y,test)
    fit('MLP weather',normalized(MLPRegressor(hidden_layer_sizes=(32,16),activation='tanh',alpha=1,max_iter=2000,n_iter_no_change=30,early_stopping=False,shuffle=False,random_state=42)),compact_x,y,compact_test)
    daily_x=np.array([data.daily(d,target) for d in training]);daily_test=data.daily(origin,target)[None,:]
    daily_y=np.array([data.days[d][target] for d in training])
    means=daily_y.mean(axis=1)
    pca=PCA(n_components=5).fit(daily_y-means[:,None])
    latent=np.c_[means,pca.transform(daily_y-means[:,None])]
    daily_model=make_pipeline(StandardScaler(),Ridge(alpha=100)).fit(daily_x,latent)
    output=daily_model.predict(daily_test)
    predictions['Daily PCA ridge']=np.maximum(0,pca.inverse_transform(output[:,1:])[0]+output[0,0])
    fit('Daily MLP',normalized(MLPRegressor(hidden_layer_sizes=(32,16),solver='lbfgs',alpha=5,max_iter=800,random_state=42)),daily_x,daily_y,daily_test)
    daily_scaler=StandardScaler().fit(daily_x)
    distance=np.linalg.norm(daily_scaler.transform(daily_x)-daily_scaler.transform(daily_test),axis=1)
    closest=np.argsort(distance)[:5];weights=1/np.maximum(distance[closest],.1)
    predictions['Weather analog days']=np.average(daily_y[closest],axis=0,weights=weights)
    audit=dict(origin=origin,target=target,cutoff=shift(origin,1),training_days=len(training),
        max_label_date=max(training),max_label_publication=max(data.days[d]['published_date'] for d in training),
        max_actual_input_date=shift(origin,2),weather_lead_hours=48,
        label_basis='ERP substation-side demand / ERP generation including imports',availability='D+1 assumed')
    return {k:v.tolist() for k,v in predictions.items()},audit,diagnostics

def convex_weights(x,y):
    """Exact L1 fit under nonnegative, sum-to-one weights."""
    n,m=x.shape
    objective=np.r_[np.zeros(m),np.ones(n)/n]
    identity=np.eye(n)
    constraints=np.r_[np.c_[x,-identity],np.c_[-x,-identity]]
    bounds=np.r_[y,-y]
    result=linprog(objective,A_ub=constraints,b_ub=bounds,A_eq=np.r_[np.ones(m),np.zeros(n)][None,:],
                   b_eq=[1.],bounds=[(0,None)]*(m+n),method='highs')
    if not result.success:raise RuntimeError(result.message)
    return result.x[:m]


def add_ensembles(data, all_predictions, origins):
    """Calibration uses only earlier OOS labels available by the forecast cutoff."""
    audit = []
    for origin in sorted(origins):
        for target in ('demand', 'generation'):
            p = all_predictions[origin, target]
            fixed = np.asarray([p[n] for n in INDEPENDENT_POOL])
            p['Independent mean ensemble'] = fixed.mean(axis=0)
            p['Independent median ensemble'] = np.median(fixed, axis=0)
            calibration = [d for d in sorted(origins) if d < origin and d in data.days
                           and data.days[d]['published_date'] <= shift(origin, 1)][-28:]
            def combine(pool, full):
                def values(day):
                    return np.asarray([all_predictions[day, target][n] for n in pool]).T
                test = values(origin)
                if len(calibration) < 7:
                    weights = inv = np.ones(len(pool)) / len(pool)
                    top = np.arange(min(3, len(pool)))
                    stacked = test @ weights
                else:
                    x = np.concatenate([values(d) for d in calibration])
                    y = np.concatenate([data.days[d][target] for d in calibration])
                    errors = np.mean(abs(x-y[:, None]), axis=0)
                    inv = 1 / np.maximum(errors, 1)**2; inv /= inv.sum()
                    weights = convex_weights(x, y)
                    top = np.argsort(errors, kind='stable')[:3]
                    stacked = make_pipeline(StandardScaler(), Ridge(alpha=100)).fit(x, y).predict(test)
                if full:
                    p['Independent full-pool convex'] = np.maximum(0, test @ weights)
                    p['Independent full-pool top3'] = test[:, top].mean(axis=1)
                    p['Independent full-pool ridge'] = np.maximum(0, stacked)
                else:
                    p['Independent inverse-error blend'] = test @ inv
                    p['Independent convex stack'] = test @ weights
                    p['Independent ridge stack'] = np.maximum(0, stacked)
                audit.append(dict(origin=origin, target=target, full_pool=full,
                    calibration_dates=calibration,
                    max_calibration_publication=max((data.days[d]['published_date'] for d in calibration), default=None),
                    pool=list(pool), convex_weights=weights.tolist(), top3=[pool[i] for i in top]))
            combine(INDEPENDENT_POOL, False)
            combine(BASE_MODELS + ('Independent mean ensemble', 'Independent median ensemble',
                                  'Independent inverse-error blend', 'Independent convex stack', 'Independent ridge stack'), True)
    return audit
